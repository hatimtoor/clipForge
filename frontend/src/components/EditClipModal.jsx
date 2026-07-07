import { useState, useEffect, useMemo, useRef } from "react";
import { fmtTime } from "../lib/theme";
import { authFetch } from "../lib/supabase";
import { Modal, Button, Banner, TextInput, SwitchRow } from "./kit";

// How many sentences to render at once in browser mode (full transcripts can
// be 1500+ sentences — rendering them all wrecks the DOM).
const PAGE = 200;

// Mirror of the backend's conservative filler list (main.py _FILLER_WORDS) —
// used only for the counter shown on the toggle; the backend re-detects.
const FILLERS = new Set(["um", "uh", "umm", "uhh", "uhm", "erm", "er", "ehm", "hmm", "hm", "mmm"]);
const countFillers = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => FILLERS.has(w.replace(/[.,!?;:…"']/g, ""))).length;

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
export default function EditClipModal({ jobId, clipIndex, clipTitle, onClose, onRendered }) {
  const isBrowse = clipIndex == null;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [textEdits, setTextEdits] = useState({}); // sentence idx -> edited text
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
        if (!res.ok) {
          setError(d.detail || "Transcript unavailable");
          return;
        }
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
      } catch {
        if (!dead) setError("Could not load the transcript");
      }
    })();
    return () => {
      dead = true;
    };
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
    return q ? sentences.filter((s) => s.text.toLowerCase().includes(q)).length : sentences.length;
  }, [sentences, isBrowse, search]);

  const [stripFillers, setStripFillers] = useState(false);
  const fillerCount = useMemo(
    () => [...selected].reduce((acc, i) => acc + countFillers(sentences[i]?.text), 0),
    [selected, sentences]
  );

  const keep = useMemo(
    () =>
      mergeIntervals(
        [...selected].map((i) => sentences[i]).filter(Boolean).map((s) => [s.start, s.end])
      ),
    [selected, sentences]
  );
  const duration = keep.reduce((acc, [a, b]) => acc + (b - a), 0);
  const cuts = Math.max(0, keep.length - 1);
  const durationOk = duration >= 3 && duration <= 180;

  const toggle = (i) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const handleRender = async () => {
    setRendering(true);
    setError("");
    try {
      const caption_overrides = Object.entries(textEdits)
        .filter(([i, t]) => selected.has(Number(i)) && t.trim() && t.trim() !== sentences[Number(i)]?.text)
        .map(([i, t]) => ({
          start: sentences[Number(i)].start,
          end: sentences[Number(i)].end,
          text: t.trim(),
        }));
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
      if (!res.ok) {
        setError(d.detail || "Render failed");
        setRendering(false);
        return;
      }
      onRendered(d.job_id);
    } catch {
      setError("Render failed. Is the server running?");
      setRendering(false);
    }
  };

  const inClipRange = (s) =>
    !data?.clip || ((s.start + s.end) / 2 >= data.clip.start && (s.start + s.end) / 2 < data.clip.end);

  return (
    <Modal
      title={isBrowse ? "Create a clip from the transcript" : `Edit: ${(clipTitle || "").slice(0, 40)}`}
      icon="✂"
      size="lg"
      onClose={onClose}
      dismissable={!rendering}
      bodyStyle={{ display: "flex", flexDirection: "column", minHeight: 300, maxHeight: "62vh" }}
      footer={
        <>
          <span
            className="t-sm"
            style={{
              marginRight: "auto",
              alignSelf: "center",
              color: durationOk ? "var(--text-2)" : "var(--danger)",
            }}
          >
            {duration.toFixed(1)}s{cuts > 0 ? ` · ${cuts} cut${cuts > 1 ? "s" : ""}` : ""}
            {!durationOk && (duration < 3 ? " (min 3s)" : " (max 3 min)")}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!durationOk || rendering} onClick={handleRender}>
            {rendering ? "Rendering…" : "⚒ Render clip"}
          </Button>
        </>
      }
    >
      <div className="t-sm" style={{ marginBottom: 10 }}>
        {isBrowse
          ? "Check the sentences you want in the clip — gaps between checked parts are cut out."
          : "Uncheck sentences to cut them · check the dimmed ones to extend the clip · ✎ fixes caption text."}
      </div>

      {error && (
        <div style={{ marginBottom: 10 }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {!data && !error && (
        <div className="t-sm" style={{ color: "var(--text-3)" }}>
          Loading transcript…
        </div>
      )}

      {isBrowse && data && (
        <div style={{ marginBottom: 10 }}>
          <TextInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search the transcript…"
          />
        </div>
      )}

      {data && (
        <div
          ref={listRef}
          style={{
            overflowY: "auto",
            flex: 1,
            border: "var(--border-w-sm) solid var(--card-border-color)",
            borderRadius: "var(--radius-md)",
            background: "var(--paper)",
            padding: 6,
          }}
        >
          {visible.map(([s, i]) => {
            const on = selected.has(i);
            const ctx = !inClipRange(s);
            const editing = editingIdx === i;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "5px 6px",
                  background: on ? "var(--success-soft)" : "transparent",
                  opacity: ctx && !on ? 0.55 : 1,
                  borderBottom: "1px dashed var(--line)",
                  cursor: "pointer",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(i)}
                  style={{ marginTop: 3, cursor: "pointer", accentColor: "var(--accent)" }}
                />
                <div style={{ flex: 1 }} onClick={() => toggle(i)}>
                  {editing ? (
                    <textarea
                      autoFocus
                      defaultValue={textEdits[i] ?? s.text}
                      rows={2}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        setTextEdits((t) => ({ ...t, [i]: e.target.value }));
                        setEditingIdx(null);
                      }}
                      className="input"
                      style={{ fontSize: "var(--fs-sm)", padding: 6 }}
                    />
                  ) : (
                    <span
                      style={{
                        fontSize: "var(--fs-sm)",
                        color: "var(--text-1)",
                        fontStyle: textEdits[i] && textEdits[i].trim() !== s.text ? "italic" : "normal",
                      }}
                    >
                      {textEdits[i] ?? s.text}
                    </span>
                  )}
                  <span className="t-mono" style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 6 }}>
                    {fmtTime(s.start)}
                  </span>
                </div>
                {on && !editing && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingIdx(i);
                    }}
                    title="Fix caption text"
                    style={{ fontSize: 13, cursor: "pointer", userSelect: "none", color: "var(--text-2)" }}
                  >
                    ✎
                  </span>
                )}
              </div>
            );
          })}
          {isBrowse && totalHits > PAGE && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", padding: 8, flexWrap: "wrap" }}>
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                ‹ Prev
              </Button>
              <span className="t-sm">
                {page * PAGE + 1}–{Math.min((page + 1) * PAGE, totalHits)} of {totalHits}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={(page + 1) * PAGE >= totalHits}
                onClick={() => setPage((p) => p + 1)}
              >
                Next ›
              </Button>
            </div>
          )}
        </div>
      )}

      {fillerCount > 0 && (
        <div style={{ marginTop: 10 }}>
          <SwitchRow
            label={`⌫ Also cut ${fillerCount} filler word${fillerCount > 1 ? "s" : ""} (um, uh…)`}
            on={stripFillers}
            onChange={setStripFillers}
          />
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isBrowse ? "Clip title (blank = AI writes one)" : "Clip title"}
        />
      </div>
    </Modal>
  );
}
