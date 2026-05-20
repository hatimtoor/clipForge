import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { C, BORDER, BORDER_SM, SHADOW, SHADOW_SM, KEYFRAMES, fmtTime } from "../lib/theme";
import { useMobile } from "../hooks/useMobile";
import {
  PixelBtn, PixelCard, Tag, Field, ProgressBar,
  PixelSprite, ANVIL, ANVIL_PAL, HAMMER, HAMMER_PAL,
  Row, PhaseSteps, SegmentedProgressBar, PHASE_RANGES,
} from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";

const STAGE_LABELS = { downloading: "DOWNLOAD", merging: "MERGE", transcribing: "TRANSCRIBE", analyzing: "ANALYZE", clipping: "CLIP", done: "DONE" };

const fmtNum = n => n == null ? "—" : n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(1)}K` : String(n);
const timeAgoShort = iso => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600)  return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`;
  return `${Math.round(s/86400)}d ago`;
};

// ── YouTube upload modal ───────────────────────────────────────────────────────
function YouTubeUploadModal({ clip, clipIndex, jobId, onClose, onUploaded }) {
  const isShort = (clip.duration || 0) <= 60;
  const [title, setTitle] = useState((clip.title || "") + (isShort ? " #Shorts" : ""));
  const [description, setDescription] = useState(
    [clip.hook, clip.reason, (clip.tags || []).map(t => `#${t}`).join(" "), isShort ? "#Shorts" : ""]
      .filter(Boolean).join("\n\n")
  );
  const [tags, setTags] = useState((clip.tags || []).join(", "));
  const [privacy, setPrivacy] = useState("public");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const pollRef = useRef(null);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const upload = async () => {
    setUploading(true); setErr("");
    try {
      const res = await authFetch(`/api/youtube/upload/${jobId}/${clipIndex}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description,
          tags: tags.split(",").map(t => t.trim()).filter(Boolean),
          privacy_status: privacy,
        }),
      });
      if (!res.ok) { setErr("Failed to start upload."); setUploading(false); return; }
      pollRef.current = setInterval(async () => {
        try {
          const r = await authFetch(`/api/youtube/upload_status/${jobId}/${clipIndex}`);
          const s = await r.json();
          if (s.status === "uploading") setProgress(s.progress || 0);
          if (s.status === "done") { clearInterval(pollRef.current); setProgress(100); setDone(s); setUploading(false); onUploaded?.(); }
          if (s.status === "error") { clearInterval(pollRef.current); setErr(s.error || "Upload failed"); setUploading(false); }
        } catch {}
      }, 2000);
    } catch { setErr("Failed to start upload."); setUploading(false); }
  };

  return (
    <div onClick={e => !uploading && e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(26,13,46,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div className="fade" style={{ width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <PixelCard color={C.cream} padding={26}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div className="pixel" style={{ fontSize: 11, color: C.ink, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: C.ytDeep }}>* YOUTUBE</span> / UPLOAD {isShort && <Tag bg={C.yt}>SHORT</Tag>}
            </div>
            {!uploading && <button onClick={onClose} className="pixel" style={{ width: 28, height: 28, background: C.cream2, border: BORDER_SM, fontSize: 14, cursor: "pointer", color: C.ink }}>x</button>}
          </div>

          {done ? (
            <div style={{ textAlign: "center" }}>
              <p className="pixel" style={{ fontSize: 11, color: C.signalDeep, marginBottom: 14 }}>v UPLOADED!</p>
              <a href={done.url} target="_blank" rel="noreferrer" className="mono" style={{ color: C.ytDeep, fontSize: 13, wordBreak: "break-all", display: "block", marginBottom: 18 }}>{done.url}</a>
              <PixelBtn color="signal" onClick={onClose}>CLOSE</PixelBtn>
            </div>
          ) : uploading ? (
            <div>
              <p className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 12 }}>UPLOADING TO YOUTUBE</p>
              <ProgressBar progress={progress} color={C.yt} />
              <p className="pixel" style={{ fontSize: 14, color: C.ytDeep, textAlign: "center", marginTop: 10 }}>{progress}%</p>
            </div>
          ) : (
            <>
              <Field label="TITLE">
                <input value={title} onChange={e => setTitle(e.target.value)} className="mono"
                  style={{ width: "100%", padding: "10px 12px", background: C.paper, border: BORDER, color: C.ink, fontSize: 13, marginBottom: 14, boxShadow: SHADOW_SM }} />
              </Field>
              <Field label="DESCRIPTION">
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} className="mono"
                  style={{ width: "100%", padding: "10px 12px", background: C.paper, border: BORDER, color: C.ink, fontSize: 13, marginBottom: 14, boxShadow: SHADOW_SM, resize: "vertical" }} />
              </Field>
              <Field label="TAGS (COMMA-SEPARATED)">
                <input value={tags} onChange={e => setTags(e.target.value)} className="mono"
                  style={{ width: "100%", padding: "10px 12px", background: C.paper, border: BORDER, color: C.ink, fontSize: 13, marginBottom: 14, boxShadow: SHADOW_SM }} />
              </Field>
              <Field label="PRIVACY">
                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                  {["public", "unlisted", "private"].map(o => {
                    const sel = privacy === o;
                    return <button key={o} onClick={() => setPrivacy(o)} className="pixel" style={{ flex: 1, padding: "10px", background: sel ? C.signal : C.paper, color: C.ink, border: BORDER, boxShadow: sel ? `0 0 0 ${C.ink}` : SHADOW_SM, transform: sel ? "translate(3px,3px)" : "none", fontSize: 9, cursor: "pointer" }}>{o.toUpperCase()}</button>;
                  })}
                </div>
              </Field>
              {err && <div className="pixel" style={{ padding: "10px 12px", background: `${C.hot}55`, border: `2px solid ${C.hotDeep}`, color: C.hotDeep, fontSize: 9, marginBottom: 14 }}>! {err}</div>}
              <PixelBtn color="yt" size="lg" full onClick={upload}>^ UPLOAD TO YOUTUBE</PixelBtn>
            </>
          )}
        </PixelCard>
      </div>
    </div>
  );
}

// ── ClipCard ───────────────────────────────────────────────────────────────────
function ClipCard({ clip, idx, cardColor, isActive, onPreview, onYTUpload, ytConnected, jobId }) {
  const [downloading, setDownloading] = useState(false);
  const [analytics, setAnalytics] = useState(clip.yt_analytics || null);
  const [statsLoading, setStatsLoading] = useState(false);
  const isMobile = useMobile();
  const previewRef = useRef(null);

  const hasYtVideo = clip.yt_upload?.status === "done" && clip.yt_upload?.video_id;

  const refreshStats = async () => {
    setStatsLoading(true);
    try {
      const res = await authFetch(`/api/jobs/${jobId}/clips/${idx}/refresh_analytics`, { method: "POST" });
      if (res.ok) setAnalytics(await res.json());
    } finally { setStatsLoading(false); }
  };

  useEffect(() => {
    if (isActive && isMobile && previewRef.current) {
      setTimeout(() => {
        const el = previewRef.current;
        if (!el) return;
        const y = el.getBoundingClientRect().top + window.pageYOffset - 12;
        window.scrollTo({ top: y, behavior: "smooth" });
      }, 120);
    }
  }, [isActive, isMobile]);

  const handleDownload = async () => {
    if (clip.presigned_url) {
      const a = document.createElement("a");
      a.href = clip.presigned_url;
      a.download = clip.filename || `clip_${idx + 1}.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    setDownloading(true);
    try {
      const res = await authFetch(clip.path);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = clip.filename || `clip_${idx + 1}.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };

  const ytUp = clip.yt_upload;
  const score = clip.virality_score || 0;
  const fillBlocks = Math.round(score / 2);

  if (isMobile) {
    return (
      <div style={{ background: cardColor, border: BORDER, boxShadow: SHADOW_SM }}>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Tag bg={C.cream}>CLIP {String(idx + 1).padStart(2, "0")}</Tag>
            <Tag bg={C.cream}>{clip.duration}S</Tag>
            <span className="pixel" style={{ fontSize: 8, color: C.dim2, marginLeft: "auto" }}>{score.toFixed(1)}/10</span>
          </div>
          <h3 className="pixel" style={{ fontSize: 10, color: C.ink, lineHeight: 1.5, marginBottom: 12 }}>{clip.title || `Clip ${idx + 1}`}</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <PixelBtn color="cream" size="sm" onClick={onPreview}>{isActive ? "|| HIDE" : "> PLAY"}</PixelBtn>
            <PixelBtn color="cream" size="sm" onClick={handleDownload} disabled={downloading}>{downloading ? "..." : "v MP4"}</PixelBtn>
            {ytConnected && (
              ytUp?.status === "done"
                ? <a href={ytUp.url} target="_blank" rel="noreferrer" className="pixel" style={{ padding: "6px 12px", fontSize: 9, color: C.ink, background: C.yt, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center", textDecoration: "none", textTransform: "uppercase" }}>{`>`} YT ^</a>
                : (ytUp?.status === "uploading" || ytUp?.status === "queued")
                  ? <span className="pixel" style={{ padding: "6px 12px", fontSize: 9, color: C.ink, background: C.amber, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center" }}>^ {ytUp.progress || 0}%</span>
                  : <PixelBtn color="yt" size="sm" onClick={onYTUpload}>^ YT</PixelBtn>
            )}
            {hasYtVideo && (
              <button onClick={refreshStats} disabled={statsLoading} className="pixel"
                style={{ padding: "6px 10px", fontSize: 8, cursor: "pointer", background: C.lavender, border: BORDER, color: C.ink, opacity: statsLoading ? 0.5 : 1 }}>
                {statsLoading ? "..." : "↻ STATS"}
              </button>
            )}
          </div>
          {hasYtVideo && analytics && (
            <div className="pixel" style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 8, color: C.dim2 }}>
              <span>👁 {fmtNum(analytics.views)}</span>
              <span>👍 {fmtNum(analytics.likes)}</span>
              <span>💬 {fmtNum(analytics.comments)}</span>
              <span style={{ marginLeft: "auto" }}>{timeAgoShort(analytics.fetched_at)}</span>
            </div>
          )}
        </div>
        {isActive && (
          <div ref={previewRef} style={{ borderTop: BORDER, background: C.windowBg }}>
            <video src={clip.presigned_url || clip.path} controls autoPlay preload="auto"
              style={{ width: "100%", display: "block" }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: cardColor, border: BORDER, boxShadow: isActive ? `8px 8px 0 ${C.ink}` : SHADOW, transform: isActive ? "translate(-3px,-3px)" : "none", transition: "transform .1s, box-shadow .1s" }}>
      <div style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr) auto", alignItems: "stretch" }}>
        <div style={{ padding: "22px 16px", borderRight: BORDER, background: `${C.cream}66`, textAlign: "center" }}>
          <div className="pixel" style={{ fontSize: 32, color: C.ink, lineHeight: 1 }}>{score.toFixed(1)}</div>
          <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginTop: 8 }}>VIRALITY / 10</div>
          <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 10 }}>
            {Array.from({ length: 5 }).map((_, k) => (
              <div key={k} style={{ width: 10, height: 10, background: k < fillBlocks ? C.ink : `${C.ink}22`, border: `1px solid ${C.ink}` }} />
            ))}
          </div>
        </div>
        <div style={{ padding: "22px 22px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Tag bg={C.cream}>CLIP {String(idx + 1).padStart(2, "0")}</Tag>
            <Tag bg={C.cream}>{fmtTime(clip.start)} -{`>`} {fmtTime(clip.end)}</Tag>
            <Tag bg={C.cream}>{clip.duration}S</Tag>
          </div>
          <h3 className="pixel" style={{ fontSize: 13, color: C.ink, lineHeight: 1.5, marginBottom: 10 }}>{clip.title || `Clip ${idx + 1}`}</h3>
          {clip.hook && <p className="vt" style={{ fontSize: 18, color: C.ink, marginBottom: 8, fontStyle: "italic", lineHeight: 1.3 }}>"{clip.hook}"</p>}
          {clip.reason && <p className="vt" style={{ fontSize: 17, color: C.dim2, lineHeight: 1.3, marginBottom: 12 }}>{clip.reason}</p>}
          {clip.tags?.length > 0 && (
            <div className="vt" style={{ display: "flex", gap: 6, fontSize: 16, color: C.ink, flexWrap: "wrap", marginBottom: hasYtVideo ? 14 : 0 }}>
              {clip.tags.map(t => <span key={t} style={{ padding: "1px 8px", background: `${C.ink}11`, border: `1px solid ${C.ink}33` }}>#{t}</span>)}
            </div>
          )}
          {hasYtVideo && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: clip.tags?.length ? 0 : 14, borderTop: `1px dashed ${C.ink}22`, flexWrap: "wrap" }}>
              {analytics ? (
                <>
                  <span className="pixel" style={{ fontSize: 9, color: C.dim2 }}>👁 {fmtNum(analytics.views)}</span>
                  <span className="pixel" style={{ fontSize: 9, color: C.dim2 }}>👍 {fmtNum(analytics.likes)}</span>
                  <span className="pixel" style={{ fontSize: 9, color: C.dim2 }}>💬 {fmtNum(analytics.comments)}</span>
                  <span className="pixel" style={{ fontSize: 8, color: C.dim, marginLeft: "auto" }}>{timeAgoShort(analytics.fetched_at)}</span>
                </>
              ) : (
                <span className="pixel" style={{ fontSize: 9, color: C.dim2 }}>No stats yet</span>
              )}
              <button onClick={refreshStats} disabled={statsLoading} className="pixel"
                style={{ marginLeft: analytics ? 0 : "auto", padding: "4px 10px", fontSize: 8, cursor: "pointer",
                  background: C.lavender, border: BORDER, color: C.ink, opacity: statsLoading ? 0.5 : 1 }}>
                {statsLoading ? "..." : "↻ STATS"}
              </button>
            </div>
          )}
        </div>
        <div style={{ padding: "22px 18px", borderLeft: BORDER, display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", background: `${C.paper}88` }}>
          <PixelBtn color="cream" size="sm" onClick={onPreview}>{isActive ? "||" : ">"} {isActive ? "HIDE" : "PLAY"}</PixelBtn>
          <PixelBtn color="cream" size="sm" onClick={handleDownload} disabled={downloading}>{downloading ? "..." : "v MP4"}</PixelBtn>
          {ytConnected && (
            ytUp?.status === "done"
              ? <a href={ytUp.url} target="_blank" rel="noreferrer" className="pixel" style={{ padding: "6px 12px", fontSize: 9, color: C.ink, background: C.yt, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center", textDecoration: "none", textTransform: "uppercase" }}>{`>`} YT ^</a>
              : (ytUp?.status === "uploading" || ytUp?.status === "queued")
                ? <span className="pixel" style={{ padding: "6px 12px", fontSize: 9, color: C.ink, background: C.amber, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center" }}>^ {ytUp.progress || 0}%</span>
                : <PixelBtn color="yt" size="sm" onClick={onYTUpload}>^ YT</PixelBtn>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Results ───────────────────────────────────────────────────────────────────
function Results({ job, ytStatus, isPro, onYTUpload, onNew, onUploadAll, uploadingAll }) {
  const clips = job.clips || [];
  const palette = [C.hot, C.signal, C.amber, C.lavender, C.peach];
  const [active, setActive] = useState(null);
  const previewRef = useRef(null);
  const isMobile = useMobile();

  const ytConnected = isPro && !!ytStatus?.connected;
  const uploadableCount = clips.filter(c => !c.yt_upload || !["done", "uploading", "queued"].includes(c.yt_upload?.status)).length;

  useEffect(() => {
    if (active && previewRef.current) previewRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  return (
    <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1380, margin: "0 auto" }}>
      <PixelCard color={C.signal} padding={26} style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div className="pixel" style={{ fontSize: 10, color: C.ink, marginBottom: 8 }}>v DELIVERED</div>
            <h1 className="pixel" style={{ fontSize: 26, color: C.ink, lineHeight: 1.2 }}>
              <span style={{ color: C.hotDeep, fontSize: 36 }}>{clips.length}</span> {clips.length === 1 ? "clip" : "clips"} ready to ship!
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {ytConnected && uploadableCount > 0 && (
              <PixelBtn color="yt" size="md" onClick={onUploadAll} disabled={uploadingAll}>
                {uploadingAll ? `^ UPLOADING...` : `^ UPLOAD ALL TO YT`}
              </PixelBtn>
            )}
            <PixelBtn color="hot" size="md" onClick={onNew}>+ NEW CLIP</PixelBtn>
          </div>
        </div>
      </PixelCard>

      <div style={{ display: "grid", gridTemplateColumns: (!isMobile && active) ? "minmax(0,1fr) 340px" : "minmax(0,1fr)", gap: 28, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {clips.map((c, i) => (
            <ClipCard
              key={i} clip={c} idx={i}
              cardColor={palette[i % palette.length]}
              ytConnected={isPro && !!ytStatus?.connected}
              isActive={active?.path === c.path}
              onPreview={() => setActive(prev => prev?.path === c.path ? null : c)}
              onYTUpload={() => onYTUpload(c, i)}
              jobId={job.job_id}
            />
          ))}
          {clips.length === 0 && (
            <PixelCard color={C.cream} padding={32} style={{ textAlign: "center" }}>
              <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>No clips were generated. Try a different video.</p>
            </PixelCard>
          )}
        </div>

        {!isMobile && active && (
          <div ref={previewRef} style={{ position: "sticky", top: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="pixel" style={{ fontSize: 9, color: C.dim2 }}>NOW PREVIEWING</div>
              <button onClick={() => setActive(null)} className="pixel" style={{ padding: "4px 8px", fontSize: 9, background: C.cream, border: BORDER_SM, boxShadow: `2px 2px 0 ${C.ink}`, cursor: "pointer" }}>x</button>
            </div>
            <div style={{ background: C.windowBg, border: BORDER, boxShadow: SHADOW, padding: 0, overflow: "hidden" }}>
              <div style={{ aspectRatio: "9/16", background: C.windowBg, position: "relative" }}>
                <video src={active.presigned_url || active.path} controls autoPlay preload="auto" style={{ width: "100%", height: "100%", display: "block", background: "#000" }} />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <Tag bg={C.cream}>CLIP {String((clips.indexOf(active)) + 1).padStart(2, "0")}</Tag>
              <p className="vt" style={{ fontSize: 18, color: C.ink, marginTop: 10, lineHeight: 1.35 }}>{active.hook || active.title}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── LiveProcessing ─────────────────────────────────────────────────────────────
function LiveProcessing({ job, onCancel }) {
  const [elapsed, setElapsed] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(job.progress || 0);
  const lastServerProgress = useRef(job.progress || 0);
  const lastServerTime = useRef(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const isMobile = useMobile();

  const handleCancel = async () => {
    setCancelling(true);
    try { await authFetch(`/api/jobs/${job.job_id}/cancel`, { method: "POST" }); } catch {}
    onCancel();
  };

  useEffect(() => { const i = setInterval(() => setElapsed(s => s + 1), 1000); return () => clearInterval(i); }, []);

  useEffect(() => {
    const p = job.progress || 0;
    if (p !== lastServerProgress.current) {
      lastServerProgress.current = p;
      lastServerTime.current = Date.now();
      setDisplayProgress(p);
    }
  }, [job.progress]);

  useEffect(() => {
    const phaseEnd = PHASE_RANGES[job.status]?.[1] ?? 100;
    const ceiling = phaseEnd - 0.5;
    const id = setInterval(() => {
      if (Date.now() - lastServerTime.current > 1500)
        setDisplayProgress(p => p < ceiling ? Math.min(p + 0.2, ceiling) : p);
    }, 300);
    return () => clearInterval(id);
  }, [job.status]);

  const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const [phaseStart, phaseEnd] = PHASE_RANGES[job.status] || [0, 100];
  const phaseProgress = Math.min(100, Math.max(0, (displayProgress - phaseStart) / (phaseEnd - phaseStart) * 100));

  return (
    <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) 360px", gap: 24, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        <PixelCard color={C.cream} padding={28}>
          <div className="pixel" style={{ fontSize: 10, color: C.hotDeep, marginBottom: 14 }}>* LIVE - {elapsedStr}</div>
          <h1 className="pixel" style={{ fontSize: 24, color: C.ink, lineHeight: 1.3, marginBottom: 8 }}>{job.message || "Forging clips"}</h1>
          <div className="vt" style={{ fontSize: 18, color: C.dim2, wordBreak: "break-all" }}>{job.url}</div>

          <div style={{ position: "relative", height: 120, marginTop: 20, marginBottom: 8, background: C.peach, border: BORDER_SM, overflow: "hidden" }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ position: "absolute", top: 34 + (i % 2) * 8, left: `${44 + i * 4}%`, width: 6, height: 6, background: C.amber, border: `1px solid ${C.ink}`, animation: `spark .8s ${i * .15}s ease-out infinite` }} />
            ))}
            <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)" }}>
              <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={6} />
            </div>
            <div style={{ position: "absolute", bottom: 64, left: "calc(50% + 8px)", transformOrigin: "bottom center", animation: "hammer 0.7s ease-in-out infinite" }}>
              <PixelSprite data={HAMMER} palette={HAMMER_PAL} size={5} />
            </div>
            <div style={{ position: "absolute", top: 8, left: 0, width: 18, height: 8, background: "#fff", border: `2px solid ${C.ink}`, animation: "drift 18s linear infinite" }} />
            <div style={{ position: "absolute", top: 22, left: 0, width: 14, height: 6, background: "#fff", border: `2px solid ${C.ink}`, animation: "drift 24s 3s linear infinite" }} />
          </div>

          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
            <SegmentedProgressBar displayProgress={displayProgress} status={job.status} />
            <PhaseSteps status={job.status} />
          </div>
        </PixelCard>

        <PixelCard color={C.paper} padding={20}>
          <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 8 }}>STATUS</div>
          <p className="vt" style={{ fontSize: 20, color: C.ink, lineHeight: 1.35 }}>
            Large videos can take 5-10 minutes. Each block fills as that stage runs and locks when it completes.
          </p>
        </PixelCard>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <PixelCard color={C.lavender} padding={22}>
          <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 10 }}>JOB - {(job.job_id || "--").slice(0, 12)}</div>
          <div className="pixel" style={{ fontSize: 42, color: C.ink, lineHeight: 1, marginBottom: 6 }}>{Math.round(phaseProgress)}<span style={{ fontSize: 18, color: C.dim2 }}>%</span></div>
          <div className="vt" style={{ fontSize: 18, color: C.dim2, marginBottom: 18 }}>this stage</div>
          <Row k="STAGE"   v={STAGE_LABELS[job.status] || job.status?.toUpperCase()} color={C.hotDeep} />
          <Row k="ELAPSED" v={elapsedStr} />
          <Row k="ETA"     v={`~${Math.max(1, 4 - Math.floor(elapsed / 60))}M`} />
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
            <PixelBtn color="danger" full onClick={onCancel}>X CLOSE / NEW</PixelBtn>
            <PixelBtn color="cream" full onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "CANCELLING..." : "X CANCEL JOB"}
            </PixelBtn>
          </div>
        </PixelCard>
      </div>
    </div>
  );
}

// ── WorkPage ───────────────────────────────────────────────────────────────────
export default function WorkPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("job");
  const { isPro, ytStatus, setJobActive } = useApp();

  const [job, setJob] = useState(null);
  const [ytModal, setYtModal] = useState(null);
  const [loading, setLoading] = useState(!!jobId);
  const [fetchError, setFetchError] = useState(false);
  const [uploadingAll, setUploadingAll] = useState(false);
  const pollRef = useRef(null);
  const uploadAllPollRef = useRef(null);
  const isTerminalRef = useRef(false);

  const isTerminal = (status) => ["done", "error", "cancelled"].includes(status);

  const fetchJob = async (id) => {
    try {
      const res = await authFetch(`/api/status/${id}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (import.meta.env.DEV) console.error(`[WorkPage] /api/status/${id} → ${res.status}`, body);
        return null;
      }
      return await res.json();
    } catch (e) {
      if (import.meta.env.DEV) console.error(`[WorkPage] fetchJob network error:`, e);
      return null;
    }
  };

  useEffect(() => {
    if (!jobId) { setJobActive(null); setLoading(false); return; }
    setLoading(true);
    setFetchError(false);
    setJob(null);
    clearInterval(pollRef.current);

    // fetch immediately
    fetchJob(jobId).then(data => {
      setLoading(false);
      if (!data) { setFetchError(true); return; }
      setJob(data);
      const terminal = isTerminal(data.status);
      isTerminalRef.current = terminal;
      setJobActive(terminal ? null : jobId);
      if (!terminal) {
        pollRef.current = setInterval(async () => {
          const d = await fetchJob(jobId);
          if (!d) return;
          setJob(d);
          if (isTerminal(d.status)) {
            clearInterval(pollRef.current);
            isTerminalRef.current = true;
            setJobActive(null);
          }
        }, 1000);
      }
    });

    return () => { clearInterval(pollRef.current); clearInterval(uploadAllPollRef.current); if (isTerminalRef.current) setJobActive(null); };
  }, [jobId]);

  const refreshJob = async () => {
    if (!jobId) return;
    const d = await fetchJob(jobId);
    if (d) setJob(d);
  };

  const handleUploadAll = async () => {
    if (!job?.clips || uploadingAll) return;
    setUploadingAll(true);
    clearInterval(uploadAllPollRef.current);
    const toUpload = job.clips
      .map((c, i) => ({ clip: c, idx: i }))
      .filter(({ clip }) => !clip.yt_upload || !["done", "uploading", "queued"].includes(clip.yt_upload?.status));
    for (const { clip, idx } of toUpload) {
      const isShort = (clip.duration || 0) <= 60;
      const title = (clip.title || `Clip ${idx + 1}`) + (isShort ? " #Shorts" : "");
      const description = [clip.hook, clip.reason, (clip.tags || []).map(t => `#${t}`).join(" "), isShort ? "#Shorts" : ""]
        .filter(Boolean).join("\n\n");
      try {
        await authFetch(`/api/youtube/upload/${jobId}/${idx}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description, tags: clip.tags || [], privacy_status: "public" }),
        });
      } catch {}
    }
    uploadAllPollRef.current = setInterval(async () => {
      const d = await fetchJob(jobId);
      if (!d) return;
      setJob(d);
      const allSettled = (d.clips || []).every(c => !c.yt_upload || ["done", "error"].includes(c.yt_upload?.status));
      if (allSettled) {
        clearInterval(uploadAllPollRef.current);
        setUploadingAll(false);
      }
    }, 2000);
  };

  const goNew = () => navigate("/hello");

  if (loading) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <div style={{ padding: "64px 32px", maxWidth: 1320, margin: "0 auto" }}>
          <PixelCard color={C.cream} padding={48} style={{ textAlign: "center" }}>
            <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Loading...</p>
          </PixelCard>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <div className="fade" style={{ padding: "64px 32px", maxWidth: 1320, margin: "0 auto" }}>
          <PixelCard color={C.hot} padding={48} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 11, color: C.ink, marginBottom: 14 }}>! JOB NOT FOUND</div>
            <h2 className="pixel" style={{ fontSize: 22, color: C.ink, marginBottom: 18 }}>Could not load this job.</h2>
            <p className="vt" style={{ fontSize: 20, color: C.ink, marginBottom: 24 }}>It may have expired or the server is unreachable.</p>
            <PixelBtn color="cream" onClick={goNew}>{`>`} NEW CLIP</PixelBtn>
          </PixelCard>
        </div>
      </div>
    );
  }

  if (!jobId || !job) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <div className="fade" style={{ padding: "64px 32px", maxWidth: 1320, margin: "0 auto" }}>
          <PixelCard color={C.cream} padding={48} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 11, color: C.dim2, marginBottom: 14 }}>NO ACTIVE JOB</div>
            <h2 className="pixel" style={{ fontSize: 22, color: C.ink, marginBottom: 18 }}>The forge is cold.</h2>
            <p className="vt" style={{ fontSize: 20, color: C.dim2, marginBottom: 24 }}>Start a new clip to fire it up.</p>
            <PixelBtn color="signal" onClick={goNew}>{`>`} NEW CLIP</PixelBtn>
          </PixelCard>
        </div>
      </div>
    );
  }

  if (job.status === "cancelled") {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <div className="fade" style={{ padding: "32px 32px 64px", maxWidth: 920, margin: "0 auto" }}>
          <PixelCard color={C.amber} padding={32} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 11, color: C.ink, marginBottom: 12 }}>JOB CANCELLED</div>
            <p className="pixel" style={{ fontSize: 14, color: C.ink, lineHeight: 1.5, marginBottom: 24 }}>The job was stopped. Any temp files have been cleaned up.</p>
            <PixelBtn color="cream" onClick={goNew} size="lg">{`>`} NEW JOB</PixelBtn>
          </PixelCard>
        </div>
      </div>
    );
  }

  if (job.status === "error") {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <div className="fade" style={{ padding: "32px 32px 64px", maxWidth: 920, margin: "0 auto" }}>
          <PixelCard color={C.hot} padding={32} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 11, color: C.ink, marginBottom: 12 }}>! JOB FAILED</div>
            <p className="pixel" style={{ fontSize: 14, color: C.ink, lineHeight: 1.5, marginBottom: 24 }}>
              {(job.error || "Something went wrong.").split("\n").pop()}
            </p>
            <PixelBtn color="cream" onClick={goNew} size="lg">{`>`} TRY AGAIN</PixelBtn>
          </PixelCard>
        </div>
      </div>
    );
  }

  if (job.status === "done") {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <Results
          job={job}
          ytStatus={ytStatus}
          isPro={isPro}
          onNew={goNew}
          onYTUpload={(clip, clipIndex) => setYtModal({ clip, clipIndex })}
          onUploadAll={handleUploadAll}
          uploadingAll={uploadingAll}
        />
        {ytModal && (
          <YouTubeUploadModal
            clip={ytModal.clip}
            clipIndex={ytModal.clipIndex}
            jobId={jobId}
            onClose={() => setYtModal(null)}
            onUploaded={refreshJob}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <LiveProcessing job={job} onCancel={goNew} />
    </div>
  );
}
