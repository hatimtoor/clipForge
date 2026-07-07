import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { C, BORDER, SHADOW, fmtTime } from "../lib/theme";
import { PixelBtn } from "./ui";
import { authFetch } from "../lib/supabase";

// How many sentences to render at once in browser mode (full transcripts can
// be 1500+ sentences — rendering them all wrecks the DOM).
const PAGE = 200;

// Mirror of the backend's conservative filler list (main.py _FILLER_WORDS) —
// used only for the counter shown on the toggle; the backend re-detects.
const FILLERS = new Set(["um", "uh", "umm", "uhh", "uhm", "erm", "er", "ehm", "hmm", "hm", "mmm"]);
const countFillers = (text) => String(text || "").toLowerCase().split(/\s+/)
  .filter(w => FILLERS.has(w.replace(/[.,!?;:…"']/g, ""))).length;

const mergeIntervals = (ivals) => {
  const sorted = [...ivals].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of sorted) {
    if (out.length && a - out[out.length - 1][1] < 0.05) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    } else out.push([a, b]);
  }
  return out;
};

// Transcript editor: check sentences to keep, uncheck to cut, edit caption
// text with the pencil. clipIndex=null → create-from-scratch browser over the
// whole transcript. Renders via POST /edit → child job like reprompt.
// Portaled to document.body — .fade's persistent transform breaks fixed
// positioning for anything mounted inside page containers.
export default function EditClipModal({ jobId, clipIndex, clipTitle, onClose, onRendered }) {
  const isBrowse = clipIndex == null;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [textEdits, setTextEdits] = useState({});   // sentence idx -> edited text
  const [editingIdx, setEditingIdx] = useState(null);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rendering, setRendering] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const q = isBrowse ? "" : `?clip=${clipIndex}`;
        const res = await authFetch(`/api/jobs/${jobId}/transcript${q}`);
        const d = await res.json();
        if (dead) return;
        if (!res.ok) { setError(d.detail || "Transcript unavailable"); return; }
        setData(d);
        if (d.clip) {
          // Preselect the sentences inside the current clip's bounds.
          const sel = new Set();
          d.sentences.forEach((s, i) => {
            const mid = (s.start + s.end) / 2;
            if (mid >= d.clip.start && mid < d.clip.end) sel.add(i);
          });
          setSelected(sel);
          setTitle(d.clip.title || "");
        }
      } catch { if (!dead) setError("Could not load the transcript"); }
    })();
    return () => { dead = true; };
  }, [jobId, clipIndex, isBrowse]);

  const sentences = data?.sentences || [];

  // Browser mode: filter by search, then paginate.
  const visible = useMemo(() => {
    if (!isBrowse) return sentences.map((s, i) => [s, i]);
    const q = search.trim().toLowerCase();
    const all = sentences.map((s, i) => [s, i]);
    const hits = q ? all.filter(([s]) => s.text.toLowerCase().includes(q)) : all;
    return hits.slice(page * PAGE, page * PAGE + PAGE);
  }, [sentences, isBrowse, search, page]);
  const totalHits = useMemo(() => {
    if (!isBrowse) return sentences.length;
    const q = search.trim().toLowerCase();
    return q ? sentences.filter(s => s.text.toLowerCase().includes(q)).length : sentences.length;
  }, [sentences, isBrowse, search]);

  const [stripFillers, setStripFillers] = useState(false);
  const fillerCount = useMemo(() =>
    [...selected].reduce((acc, i) => acc + countFillers(sentences[i]?.text), 0),
  [selected, sentences]);

  const keep = useMemo(() => mergeIntervals(
    [...selected].map(i => sentences[i]).filter(Boolean).map(s => [s.start, s.end])
  ), [selected, sentences]);
  const duration = keep.reduce((acc, [a, b]) => acc + (b - a), 0);
  const cuts = Math.max(0, keep.length - 1);
  const durationOk = duration >= 3 && duration <= 180;

  const toggle = (i) => setSelected(prev => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const handleRender = async () => {
    setRendering(true); setError("");
    try {
      const caption_overrides = Object.entries(textEdits)
        .filter(([i, t]) => selected.has(Number(i)) && t.trim() && t.trim() !== sentences[Number(i)]?.text)
        .map(([i, t]) => ({ start: sentences[Number(i)].start, end: sentences[Number(i)].end, text: t.trim() }));
      const res = await authFetch(`/api/jobs/${jobId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_index: isBrowse ? undefined : clipIndex,
          keep,
          title: title.trim() || undefined,
          caption_overrides: caption_overrides.length ? caption_overrides : undefined,
          remove_fillers: stripFillers,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.detail || "Render failed"); setRendering(false); return; }
      onRendered(d.job_id);
    } catch { setError("Render failed. Is the server running?"); setRendering(false); }
  };

  const inClipRange = (s) => !data?.clip
    || ((s.start + s.end) / 2 >= data.clip.start && (s.start + s.end) / 2 < data.clip.end);

  const body = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,13,46,.7)", zIndex: 299 }} />
      <div className="pixel" style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(640px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column",
        background: C.cream, border: `3px solid ${C.ink}`, boxShadow: SHADOW, padding: 16, zIndex: 300,
      }}>
        <div style={{ fontSize: 9, color: C.ink, marginBottom: 4 }}>
          {isBrowse ? "✂ CREATE A CLIP FROM THE TRANSCRIPT" : `✂ EDIT: ${(clipTitle || "").slice(0, 40)}`}
        </div>
        <div className="vt" style={{ fontSize: 14, color: C.dim2, marginBottom: 8, letterSpacing: 0, textTransform: "none" }}>
          {isBrowse
            ? "check the sentences you want in the clip — gaps between checked parts are cut out"
            : "uncheck sentences to cut them · check the dimmed ones to extend the clip · ✎ fixes caption text"}
        </div>

        {error && <div className="vt" style={{ color: C.hot, fontSize: 14, marginBottom: 6 }}>{error}</div>}
        {!data && !error && <div className="vt" style={{ fontSize: 14, color: C.dim2 }}>loading transcript…</div>}

        {isBrowse && data && (
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="search the transcript…" className="vt"
            style={{ fontSize: 15, padding: "6px 8px", border: BORDER, marginBottom: 8, background: "#fff", color: C.ink }} />
        )}

        <div ref={listRef} style={{ overflowY: "auto", flex: 1, border: BORDER, background: "#fff", padding: 6 }}>
          {visible.map(([s, i]) => {
            const on = selected.has(i);
            const ctx = !inClipRange(s);
            const editing = editingIdx === i;
            return (
              <div key={i} style={{
                display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 6px",
                background: on ? `${C.signal}22` : "transparent",
                opacity: ctx && !on ? 0.55 : 1,
                borderBottom: `1px dashed ${C.ink}22`, cursor: "pointer",
              }}>
                <input type="checkbox" checked={on} onChange={() => toggle(i)} style={{ marginTop: 3, cursor: "pointer" }} />
                <div style={{ flex: 1 }} onClick={() => toggle(i)}>
                  {editing ? (
                    <textarea autoFocus defaultValue={textEdits[i] ?? s.text} rows={2}
                      onClick={e => e.stopPropagation()}
                      onBlur={e => { setTextEdits(t => ({ ...t, [i]: e.target.value })); setEditingIdx(null); }}
                      className="vt" style={{ width: "100%", fontSize: 15, border: BORDER, padding: 4 }} />
                  ) : (
                    <span className="vt" style={{ fontSize: 15, color: C.ink, letterSpacing: 0, textTransform: "none",
                      fontStyle: textEdits[i] && textEdits[i].trim() !== s.text ? "italic" : "normal" }}>
                      {textEdits[i] ?? s.text}
                    </span>
                  )}
                  <span className="vt" style={{ fontSize: 12, color: C.dim2, marginLeft: 6 }}>{fmtTime(s.start)}</span>
                </div>
                {on && !editing && (
                  <span onClick={e => { e.stopPropagation(); setEditingIdx(i); }}
                    title="fix caption text" style={{ fontSize: 12, cursor: "pointer", userSelect: "none" }}>✎</span>
                )}
              </div>
            );
          })}
          {isBrowse && totalHits > PAGE && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: 8 }}>
              <PixelBtn color="cream" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ PREV</PixelBtn>
              <span className="vt" style={{ fontSize: 13, color: C.dim2, alignSelf: "center" }}>
                {page * PAGE + 1}–{Math.min((page + 1) * PAGE, totalHits)} of {totalHits}
              </span>
              <PixelBtn color="cream" size="sm" disabled={(page + 1) * PAGE >= totalHits} onClick={() => setPage(p => p + 1)}>NEXT ›</PixelBtn>
            </div>
          )}
        </div>

        {fillerCount > 0 && (
          <label className="vt" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8,
            fontSize: 15, color: C.ink, cursor: "pointer", letterSpacing: 0, textTransform: "none" }}>
            <input type="checkbox" checked={stripFillers} onChange={e => setStripFillers(e.target.checked)} />
            ⌫ also cut {fillerCount} filler word{fillerCount > 1 ? "s" : ""} (um, uh…)
          </label>
        )}

        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder={isBrowse ? "clip title (blank = AI writes one)" : "clip title"} className="vt"
          style={{ fontSize: 15, padding: "6px 8px", border: BORDER, margin: "8px 0", background: "#fff", color: C.ink }} />

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <PixelBtn color="signal" size="sm" disabled={!durationOk || rendering} onClick={handleRender}>
            {rendering ? "RENDERING…" : "⚒ RENDER CLIP"}
          </PixelBtn>
          <PixelBtn color="cream" size="sm" onClick={onClose}>CANCEL</PixelBtn>
          <span className="vt" style={{ fontSize: 14, marginLeft: "auto", color: durationOk ? C.dim2 : C.hot }}>
            {duration.toFixed(1)}s{cuts > 0 ? ` · ${cuts} cut${cuts > 1 ? "s" : ""}` : ""}
            {!durationOk && (duration < 3 ? " (min 3s)" : " (max 3 min)")}
          </span>
        </div>
      </div>
    </>
  );

  return createPortal(body, document.body);
}
