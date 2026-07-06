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
import EditClipModal from "../components/EditClipModal";
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
function YouTubeUploadModal({ clip, clipIndex, jobId, ytChannels, onClose, onUploaded }) {
  const isShort = (clip.duration || 0) <= 60;
  const [title, setTitle] = useState((clip.title || "") + (isShort ? " #Shorts" : ""));
  const [description, setDescription] = useState(
    [clip.hook, clip.reason, (clip.tags || []).map(t => `#${t}`).join(" "), isShort ? "#Shorts" : ""]
      .filter(Boolean).join("\n\n")
  );
  const [tags, setTags] = useState((clip.tags || []).join(", "));
  const [privacy, setPrivacy] = useState("public");
  const [selectedChannel, setSelectedChannel] = useState(ytChannels?.[0]?.yt_channel_id || "");
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
          yt_channel_id: selectedChannel || undefined,
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
              {ytChannels && ytChannels.length > 1 && (
                <Field label="UPLOAD TO">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                    {ytChannels.map(ch => {
                      const sel = selectedChannel === ch.yt_channel_id;
                      return (
                        <button key={ch.yt_channel_id} onClick={() => setSelectedChannel(ch.yt_channel_id)} className="pixel"
                          style={{ padding: "8px 14px", fontSize: 9, background: sel ? C.yt : C.paper, color: C.ink,
                            border: BORDER, boxShadow: sel ? `0 0 0 ${C.ink}` : SHADOW_SM,
                            transform: sel ? "translate(3px,3px)" : "none", cursor: "pointer", transition: "all .1s" }}>
                          {ch.yt_channel_name || "YouTube"}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
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

// ── TikTok clip button (opens the upload modal) ────────────────────────────────
const TT_PRIVACY_LABELS = {
  PUBLIC_TO_EVERYONE: "Everyone",
  FOLLOWER_OF_CREATOR: "Followers",
  MUTUAL_FOLLOW_FRIENDS: "Friends only",
  SELF_ONLY: "Only me (private)",
};

function TikTokClipButton({ clip, onOpen }) {
  const st = clip.tt_upload?.status;
  const black = { padding: "6px 12px", fontSize: 9, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center", textTransform: "uppercase", cursor: "pointer" };
  if (st === "done")
    return <span className="pixel" title={clip.tt_upload?.note || "Sent to TikTok"} style={{ ...black, background: C.ttDeep, color: C.cream, cursor: "default" }}>♪ SENT</span>;
  if (st === "queued" || st === "uploading")
    return <span className="pixel" style={{ ...black, background: C.tt, color: C.ink }}>♪ SENDING...</span>;
  return <PixelBtn color="tt" size="sm" onClick={onOpen}>♪ TIKTOK</PixelBtn>;
}

// ── TikTok upload modal (audit-compliant: privacy + disclosure) ─────────────────
function TikTokUploadModal({ clip, clipIndex, jobId, ttAccounts, onClose, onUploaded }) {
  const tags = clip.tags || [];
  const defaultCaption = [clip.title || clip.hook || "", tags.map(t => `#${t}`).join(" ")].filter(Boolean).join(" ");
  const [account, setAccount] = useState(ttAccounts?.[0]?.tt_open_id || "");
  const [caption, setCaption] = useState(defaultCaption);
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [privacy, setPrivacy] = useState("");
  const [allowComment, setAllowComment] = useState(true);
  const [allowDuet, setAllowDuet] = useState(true);
  const [allowStitch, setAllowStitch] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const pollRef = useRef(null);
  useEffect(() => () => clearInterval(pollRef.current), []);

  useEffect(() => {
    let cancelled = false;
    setLoadingInfo(true); setInfo(null); setPrivacy(""); setErr("");
    (async () => {
      try {
        const q = account ? `?tt_open_id=${encodeURIComponent(account)}` : "";
        const r = await authFetch(`/api/tiktok/creator_info${q}`);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) { setErr(d.detail || "Couldn't load TikTok account info."); setLoadingInfo(false); return; }
        setInfo(d);
        setAllowComment(!d.comment_disabled);
        setAllowDuet(!d.duet_disabled);
        setAllowStitch(!d.stitch_disabled);
        setLoadingInfo(false);
      } catch { if (!cancelled) { setErr("Couldn't reach server."); setLoadingInfo(false); } }
    })();
    return () => { cancelled = true; };
  }, [account]);

  const upload = async () => {
    if (!privacy) { setErr("Please choose who can view this video."); return; }
    setUploading(true); setErr("");
    try {
      const res = await authFetch(`/api/tiktok/upload/${jobId}/${clipIndex}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tt_open_id: account || undefined,
          title: caption,
          privacy_level: privacy,
          disable_comment: !allowComment,
          disable_duet: !allowDuet,
          disable_stitch: !allowStitch,
        }),
      });
      if (!res.ok) { setErr("Failed to start upload."); setUploading(false); return; }
      pollRef.current = setInterval(async () => {
        try {
          const r = await authFetch(`/api/tiktok/upload_status/${jobId}/${clipIndex}`);
          const s = await r.json();
          if (s.status === "done") { clearInterval(pollRef.current); setDone(s); setUploading(false); onUploaded?.(); }
          if (s.status === "error") { clearInterval(pollRef.current); setErr(s.error || "Upload failed"); setUploading(false); }
        } catch {}
      }, 2000);
    } catch { setErr("Failed to start upload."); setUploading(false); }
  };

  const toggle = (label, on, setOn, disabled) => (
    <button onClick={() => !disabled && setOn(!on)} disabled={disabled} className="pixel" style={{
      flex: 1, padding: "9px 6px", fontSize: 8, cursor: disabled ? "not-allowed" : "pointer",
      background: disabled ? C.cream2 : on ? C.signal : C.paper, color: disabled ? C.dim : C.ink,
      border: BORDER, opacity: disabled ? 0.6 : 1,
    }}>{label}{disabled ? " (off)" : on ? " ✓" : ""}</button>
  );

  const privacyOptions = info?.privacy_level_options || [];

  return (
    <div onClick={e => !uploading && e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(26,13,46,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div className="fade" style={{ width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <PixelCard color={C.cream} padding={26}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div className="pixel" style={{ fontSize: 11, color: C.ink }}>♪ TIKTOK / POST</div>
            {!uploading && <button onClick={onClose} className="pixel" style={{ width: 28, height: 28, background: C.cream2, border: BORDER_SM, fontSize: 14, cursor: "pointer", color: C.ink }}>x</button>}
          </div>

          {done ? (
            <div style={{ textAlign: "center" }}>
              <p className="pixel" style={{ fontSize: 11, color: C.signalDeep, marginBottom: 12 }}>v SENT TO TIKTOK!</p>
              <p className="vt" style={{ fontSize: 17, color: C.dim2, marginBottom: 18 }}>{done.note || "Open the TikTok app to see it."}</p>
              <PixelBtn color="signal" onClick={onClose}>CLOSE</PixelBtn>
            </div>
          ) : uploading ? (
            <div>
              <p className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 12 }}>SENDING TO TIKTOK...</p>
              <ProgressBar progress={50} color={C.tt} />
            </div>
          ) : loadingInfo ? (
            <p className="vt" style={{ fontSize: 18, color: C.dim2, textAlign: "center", padding: "20px 0" }}>Loading your TikTok account…</p>
          ) : (
            <>
              {ttAccounts && ttAccounts.length > 1 && (
                <Field label="POST TO">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                    {ttAccounts.map(acc => {
                      const sel = account === acc.tt_open_id;
                      return (
                        <button key={acc.tt_open_id} onClick={() => setAccount(acc.tt_open_id)} className="pixel"
                          style={{ padding: "8px 14px", fontSize: 9, background: sel ? C.tt : C.paper, color: C.ink,
                            border: BORDER, boxShadow: sel ? `0 0 0 ${C.ink}` : SHADOW_SM,
                            transform: sel ? "translate(3px,3px)" : "none", cursor: "pointer" }}>
                          ♪ {acc.tt_display_name || "TikTok"}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}

              <Field label="CAPTION">
                <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} maxLength={2200} className="mono"
                  style={{ width: "100%", padding: "10px 12px", background: C.paper, border: BORDER, color: C.ink, fontSize: 13, marginBottom: 14, boxShadow: SHADOW_SM, resize: "vertical" }} />
              </Field>

              <Field label="WHO CAN VIEW THIS VIDEO">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  {privacyOptions.map(o => {
                    const sel = privacy === o;
                    return <button key={o} onClick={() => setPrivacy(o)} className="pixel" style={{ padding: "9px 12px", background: sel ? C.signal : C.paper, color: C.ink, border: BORDER, boxShadow: sel ? `0 0 0 ${C.ink}` : SHADOW_SM, transform: sel ? "translate(3px,3px)" : "none", fontSize: 9, cursor: "pointer" }}>{TT_PRIVACY_LABELS[o] || o}</button>;
                  })}
                </div>
              </Field>

              <Field label="ALLOW">
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {toggle("Comments", allowComment, setAllowComment, info?.comment_disabled)}
                  {toggle("Duet", allowDuet, setAllowDuet, info?.duet_disabled)}
                  {toggle("Stitch", allowStitch, setAllowStitch, info?.stitch_disabled)}
                </div>
              </Field>

              {/* Required compliance disclosure */}
              <div className="vt" style={{ fontSize: 14, color: C.dim2, lineHeight: 1.5, marginBottom: 16, padding: "10px 12px", background: `${C.lavender}44`, border: `2px solid ${C.ink}22` }}>
                By posting, you agree to TikTok's{" "}
                <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" style={{ color: C.hotDeep }}>Music Usage Confirmation</a>.
                Your video will be posted to your selected TikTok account.
              </div>

              {err && <div className="pixel" style={{ padding: "10px 12px", background: `${C.hot}55`, border: `2px solid ${C.hotDeep}`, color: C.hotDeep, fontSize: 9, marginBottom: 14 }}>! {err}</div>}

              <PixelBtn color="tt" size="lg" full onClick={upload} disabled={!privacy}>
                ♪ POST TO TIKTOK
              </PixelBtn>
            </>
          )}
        </PixelCard>
      </div>
    </div>
  );
}

// ── ClipCard ───────────────────────────────────────────────────────────────────
function ClipCard({ clip, idx, cardColor, isActive, onPreview, onYTUpload, onTTUpload, onEdit, ytConnected, jobId, ttConnected, ttAccounts, isPro }) {
  const [downloading, setDownloading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const navigate = useNavigate();

  const handleExport = async (fmt) => {
    setExportOpen(false);
    if (fmt !== "srt" && !isPro) { navigate("/upgrade"); return; }
    try {
      const res = await authFetch(`/api/jobs/${jobId}/clips/${idx}/export?fmt=${fmt}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = m ? m[1] : `clip_${idx + 1}.${fmt === "xml" ? "xml" : fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* non-fatal */ }
  };
  const [analytics, setAnalytics] = useState(clip.yt_analytics || null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [clipToken, setClipToken] = useState(null);
  const isMobile = useMobile();
  const previewRef = useRef(null);

  const hasYtVideo = clip.yt_upload?.status === "done" && clip.yt_upload?.video_id;

  useEffect(() => {
    if (!isActive || clip.presigned_url || !clip.filename) return;
    authFetch(`/api/clip-token/${jobId}/${clip.filename}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.token) setClipToken(`/clips/${jobId}/${clip.filename}?t=${data.token}`); })
      .catch(() => {});
  }, [isActive, clip.presigned_url, clip.filename, jobId]);

  const videoSrc = clip.presigned_url || clipToken;

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

  const handleDownloadThumb = () => {
    if (!clip.thumbnail_url) return;
    const a = document.createElement("a");
    a.href = clip.thumbnail_url;
    a.download = `clip_${idx + 1}_thumbnail.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  const ytUp = clip.yt_upload;
  const score = clip.virality_score || 0;
  const fillBlocks = Math.round(score / 2);
  // 0-99 score with hook/flow/value/trend breakdown (new jobs); old jobs only
  // have the legacy 1-10 score, which scales up for a consistent display.
  const score99 = clip.score ?? (clip.virality_score ? Math.round(clip.virality_score * 10) : 0);
  const subs = clip.scores || null;

  if (isMobile) {
    return (
      <div style={{ background: cardColor, border: BORDER, boxShadow: SHADOW_SM }}>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Tag bg={C.cream}>CLIP {String(idx + 1).padStart(2, "0")}</Tag>
            <Tag bg={C.cream}>{clip.duration}S</Tag>
            <span className="pixel" style={{ fontSize: 8, color: C.dim2, marginLeft: "auto" }}>{score99}/99</span>
          </div>
          <h3 className="pixel" style={{ fontSize: 10, color: C.ink, lineHeight: 1.5, marginBottom: 12 }}>{clip.title || `Clip ${idx + 1}`}</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <PixelBtn color="cream" size="sm" onClick={onPreview}>{isActive ? "|| HIDE" : "> PLAY"}</PixelBtn>
            <PixelBtn color="cream" size="sm" onClick={handleDownload} disabled={downloading}>{downloading ? "..." : "v MP4"}</PixelBtn>
            {clip.thumbnail_url && <PixelBtn color="cream" size="sm" onClick={handleDownloadThumb}>v JPG</PixelBtn>}
            {ytConnected && (
              ytUp?.status === "done"
                ? <a href={ytUp.url} target="_blank" rel="noreferrer" className="pixel" style={{ padding: "6px 12px", fontSize: 9, color: C.ink, background: C.yt, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center", textDecoration: "none", textTransform: "uppercase" }}>{`>`} YT ^</a>
                : (ytUp?.status === "uploading" || ytUp?.status === "queued")
                  ? <span className="pixel" style={{ padding: "6px 12px", fontSize: 9, color: C.ink, background: C.amber, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center" }}>^ {ytUp.progress || 0}%</span>
                  : <PixelBtn color="yt" size="sm" onClick={onYTUpload}>^ YT</PixelBtn>
            )}
            {ttConnected && <TikTokClipButton clip={clip} onOpen={() => onTTUpload(clip, idx)} />}
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
            <video src={videoSrc} poster={clip.thumbnail_url || undefined} controls autoPlay preload="auto"
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
          <div className="pixel" style={{ fontSize: 32, color: C.ink, lineHeight: 1 }}>{score99}</div>
          <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginTop: 8 }}>VIRALITY / 99</div>
          {subs ? (
            <div style={{ marginTop: 10, display: "grid", gap: 3 }}>
              {[["HOOK", subs.hook], ["FLOW", subs.flow], ["VALUE", subs.value], ["TREND", subs.trend]].map(([lbl, v]) => (
                <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="pixel" style={{ fontSize: 6, color: C.dim2, width: 30, textAlign: "left" }}>{lbl}</span>
                  <div style={{ flex: 1, height: 6, background: `${C.ink}22`, border: `1px solid ${C.ink}` }}>
                    <div style={{ width: `${Math.min(100, (v || 0) / 0.99)}%`, height: "100%", background: C.ink }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 10 }}>
              {Array.from({ length: 5 }).map((_, k) => (
                <div key={k} style={{ width: 10, height: 10, background: k < fillBlocks ? C.ink : `${C.ink}22`, border: `1px solid ${C.ink}` }} />
              ))}
            </div>
          )}
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
          {onEdit && <PixelBtn color="lavender" size="sm" onClick={onEdit}>✂ EDIT</PixelBtn>}
          <PixelBtn color="cream" size="sm" onClick={handleDownload} disabled={downloading}>{downloading ? "..." : "v MP4"}</PixelBtn>
          {clip.thumbnail_url && <PixelBtn color="cream" size="sm" onClick={handleDownloadThumb}>v JPG</PixelBtn>}
          <div style={{ position: "relative" }}>
            <PixelBtn color="cream" size="sm" onClick={() => setExportOpen(o => !o)}>v MORE</PixelBtn>
            {exportOpen && (
              <>
                <div onClick={() => setExportOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 199 }} />
                <div className="pixel" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 200,
                  background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: 8, width: 190 }}>
                  {[["srt", "CC SRT CAPTIONS", false],
                    ["xml", "PREMIERE XML", true],
                    ["fcpxml", "FINAL CUT XML", true]].map(([fmt, label, pro]) => (
                    <button key={fmt} onClick={() => handleExport(fmt)} className="pixel" style={{
                      display: "block", width: "100%", textAlign: "left", padding: "7px 9px", marginBottom: 4,
                      fontSize: 8, background: C.cream2, color: C.ink, border: BORDER, cursor: "pointer" }}>
                      {label}{pro && !isPro ? " 🔒" : ""}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {ytConnected && (
            ytUp?.status === "done"
              ? <a href={ytUp.url} target="_blank" rel="noreferrer" className="pixel" style={{ padding: "6px 12px", fontSize: 9, color: C.ink, background: C.yt, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center", textDecoration: "none", textTransform: "uppercase" }}>{`>`} YT ^</a>
              : (ytUp?.status === "uploading" || ytUp?.status === "queued")
                ? <span className="pixel" style={{ padding: "6px 12px", fontSize: 9, color: C.ink, background: C.amber, border: BORDER, boxShadow: SHADOW_SM, textAlign: "center" }}>^ {ytUp.progress || 0}%</span>
                : <PixelBtn color="yt" size="sm" onClick={onYTUpload}>^ YT</PixelBtn>
          )}
          {ttConnected && <TikTokClipButton clip={clip} onOpen={() => onTTUpload(clip, idx)} />}
        </div>
      </div>
    </div>
  );
}

// ── Results ───────────────────────────────────────────────────────────────────
function Results({ job, ytStatus, ttStatus, isPro, onYTUpload, onTTUpload, onNew, onUploadAll, onUploadAllTikTok, uploadingAll }) {
  const clips = job.clips || [];
  const palette = [C.hot, C.signal, C.amber, C.lavender, C.peach];
  const [active, setActive] = useState(null);
  const navigate = useNavigate();
  const [repromptOpen, setRepromptOpen] = useState(false);
  const [repromptFind, setRepromptFind] = useState("");
  const [repromptExclude, setRepromptExclude] = useState("");
  const [reprompting, setReprompting] = useState(false);
  const [repromptError, setRepromptError] = useState("");
  // Transcript editor: {clipIndex, title} = edit that clip; {clipIndex: null} =
  // create-from-scratch over the whole transcript.
  const [editTarget, setEditTarget] = useState(null);
  // Manual cam-box picker: draw a rectangle on a source frame; sent normalized.
  const [camOpen, setCamOpen] = useState(false);
  const [camFrameUrl, setCamFrameUrl] = useState(null);
  const [camBox, setCamBox] = useState(null);        // {x,y,w,h} normalized
  const [camDrag, setCamDrag] = useState(null);
  const camImgRef = useRef(null);

  const openCamPicker = async () => {
    setCamOpen(o => !o);
    if (camFrameUrl || camOpen) return;
    try {
      const res = await authFetch(`/api/jobs/${job.job_id}/frame?t=3`);
      if (!res.ok) { setRepromptError("Source expired — cam box unavailable for this job"); setCamOpen(false); return; }
      const blob = await res.blob();
      setCamFrameUrl(URL.createObjectURL(blob));
    } catch { setCamOpen(false); }
  };

  const camPoint = (e) => {
    const r = camImgRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: Math.max(0, Math.min(1, cx / r.width)), y: Math.max(0, Math.min(1, cy / r.height)) };
  };
  const camDown = (e) => { e.preventDefault(); const p = camPoint(e); setCamDrag(p); setCamBox({ x: p.x, y: p.y, w: 0, h: 0 }); };
  const camMove = (e) => {
    if (!camDrag) return;
    const p = camPoint(e);
    setCamBox({ x: Math.min(camDrag.x, p.x), y: Math.min(camDrag.y, p.y),
                w: Math.abs(p.x - camDrag.x), h: Math.abs(p.y - camDrag.y) });
  };
  const camUp = () => setCamDrag(null);

  const handleReprompt = async () => {
    setReprompting(true); setRepromptError("");
    try {
      const body = {
        find: repromptFind.trim() || undefined,
        exclude: repromptExclude.trim() || undefined,
      };
      if (camBox && camBox.w > 0.02 && camBox.h > 0.02) {
        body.facecam_box = [camBox.x, camBox.y, camBox.w, camBox.h];
        // A manual cam box implies a cam layout — keep the parent's if it was
        // already gameplay/screenshare, else default to gameplay.
        body.layout = ["facecam", "gameplay", "screenshare"].includes(job.options?.clip_style || job.options?.layout)
          ? undefined : "gameplay";
      }
      const res = await authFetch(`/api/jobs/${job.job_id}/reprompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setRepromptError(data.detail || "Reprompt failed"); setReprompting(false); return; }
      navigate(`/work?job=${data.job_id}`);
      window.location.reload();
    } catch {
      setRepromptError("Reprompt failed. Is the server running?");
      setReprompting(false);
    }
  };
  const [activeToken, setActiveToken] = useState(null);
  const previewRef = useRef(null);
  const isMobile = useMobile();
  const ytChannels = ytStatus?.channels || [];
  const ttConnected = isPro && !!ttStatus?.connected;
  const ttAccounts = ttStatus?.accounts || [];
  const [uploadAllPickerOpen, setUploadAllPickerOpen] = useState(false);
  const [uploadAllChannel, setUploadAllChannel] = useState(ytChannels[0]?.yt_channel_id || "");
  const [ttPickerOpen, setTtPickerOpen] = useState(false);
  const [ttAllAccount, setTtAllAccount] = useState(ttAccounts[0]?.tt_open_id || "");

  const ytConnected = isPro && !!ytStatus?.connected;
  const uploadableCount = clips.filter(c => !c.yt_upload || !["done", "uploading", "queued"].includes(c.yt_upload?.status)).length;
  const ttUploadableCount = clips.filter(c => !c.tt_upload || !["done", "uploading", "queued"].includes(c.tt_upload?.status)).length;

  const handleUploadAllClick = () => {
    if (ytChannels.length > 1) {
      setUploadAllPickerOpen(true);
    } else {
      onUploadAll(ytChannels[0]?.yt_channel_id || "");
    }
  };

  const handleUploadAllConfirm = () => {
    setUploadAllPickerOpen(false);
    onUploadAll(uploadAllChannel);
  };

  const handleTtAllClick = () => {
    if (ttAccounts.length > 1) setTtPickerOpen(true);
    else onUploadAllTikTok(ttAccounts[0]?.tt_open_id || "");
  };

  const handleTtAllConfirm = () => {
    setTtPickerOpen(false);
    onUploadAllTikTok(ttAllAccount);
  };

  useEffect(() => {
    if (active && previewRef.current) previewRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (!active || active.presigned_url || !active.filename) { setActiveToken(null); return; }
    authFetch(`/api/clip-token/${job.job_id}/${active.filename}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.token) setActiveToken(`/clips/${job.job_id}/${active.filename}?t=${data.token}`); })
      .catch(() => {});
  }, [active, job.job_id]);

  return (
    <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1380, margin: "0 auto" }}>
      <PixelCard color={C.signal} padding={isMobile ? 18 : 26} style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div className="pixel" style={{ fontSize: 10, color: C.ink, marginBottom: 8 }}>v DELIVERED</div>
            <h1 className="pixel" style={{ fontSize: isMobile ? 18 : 26, color: C.ink, lineHeight: 1.2 }}>
              <span style={{ color: C.hotDeep, fontSize: isMobile ? 26 : 36 }}>{clips.length}</span> {clips.length === 1 ? "clip" : "clips"} ready to ship!
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {ytConnected && uploadableCount > 0 && (
              <div style={{ position: "relative" }}>
                <PixelBtn color="yt" size={isMobile ? "sm" : "md"} onClick={handleUploadAllClick} disabled={uploadingAll}>
                  {uploadingAll ? `^ UPLOADING...` : isMobile ? `^ ALL TO YT` : `^ UPLOAD ALL TO YT`}
                </PixelBtn>
                {uploadAllPickerOpen && (
                  <>
                  {isMobile && <div onClick={() => setUploadAllPickerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(26,13,46,.6)", zIndex: 199 }} />}
                  <div className="pixel" style={{
                    background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: 12, zIndex: 200,
                    ...(isMobile
                      ? { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(330px,92vw)", maxHeight: "80vh", overflowY: "auto" }
                      : { position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 210 }),
                  }}>
                    <div style={{ fontSize: 8, color: C.dim2, marginBottom: 10 }}>SELECT CHANNEL</div>
                    {ytChannels.map(ch => (
                      <button key={ch.yt_channel_id} onClick={() => setUploadAllChannel(ch.yt_channel_id)} className="pixel" style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 10px", marginBottom: 6, fontSize: 9,
                        background: uploadAllChannel === ch.yt_channel_id ? C.yt : C.cream2,
                        color: C.ink, border: BORDER, cursor: "pointer",
                      }}>
                        {uploadAllChannel === ch.yt_channel_id ? "* " : "  "}{ch.yt_channel_name || ch.yt_channel_id}
                      </button>
                    ))}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <PixelBtn color="yt" size="sm" onClick={handleUploadAllConfirm} disabled={!uploadAllChannel}>UPLOAD ALL</PixelBtn>
                      <PixelBtn color="cream" size="sm" onClick={() => setUploadAllPickerOpen(false)}>CANCEL</PixelBtn>
                    </div>
                  </div>
                  </>
                )}
              </div>
            )}
            {ttConnected && ttUploadableCount > 0 && (
              <div style={{ position: "relative" }}>
                <PixelBtn color="tt" size={isMobile ? "sm" : "md"} onClick={handleTtAllClick} disabled={uploadingAll}>
                  {isMobile ? "♪ ALL TO TT" : "♪ ALL TO TIKTOK"}
                </PixelBtn>
                {ttPickerOpen && (
                  <>
                  {isMobile && <div onClick={() => setTtPickerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(26,13,46,.6)", zIndex: 199 }} />}
                  <div className="pixel" style={{
                    background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: 12, zIndex: 200,
                    ...(isMobile
                      ? { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(330px,92vw)", maxHeight: "80vh", overflowY: "auto" }
                      : { position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 210 }),
                  }}>
                    <div style={{ fontSize: 8, color: C.dim2, marginBottom: 10 }}>SELECT TIKTOK ACCOUNT</div>
                    {ttAccounts.map(a => (
                      <button key={a.tt_open_id} onClick={() => setTtAllAccount(a.tt_open_id)} className="pixel" style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 10px", marginBottom: 6, fontSize: 9,
                        background: ttAllAccount === a.tt_open_id ? C.tt : C.cream2,
                        color: C.ink, border: BORDER, cursor: "pointer",
                      }}>
                        {ttAllAccount === a.tt_open_id ? "♪ " : "  "}{a.tt_display_name || a.tt_open_id}
                      </button>
                    ))}
                    <div className="vt" style={{ fontSize: 13, color: C.dim2, lineHeight: 1.4, margin: "8px 0" }}>
                      By posting, you agree to TikTok's <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" style={{ color: C.hotDeep }}>Music Usage Confirmation</a>.
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <PixelBtn color="tt" size="sm" onClick={handleTtAllConfirm} disabled={!ttAllAccount}>SEND ALL</PixelBtn>
                      <PixelBtn color="cream" size="sm" onClick={() => setTtPickerOpen(false)}>CANCEL</PixelBtn>
                    </div>
                  </div>
                  </>
                )}
              </div>
            )}
            <div style={{ position: "relative" }}>
              <PixelBtn color="lavender" size={isMobile ? "sm" : "md"} onClick={() => setRepromptOpen(o => !o)}>
                {isMobile ? "? MORE" : "? FIND MORE CLIPS"}
              </PixelBtn>
              {repromptOpen && (
                <>
                {isMobile && <div onClick={() => setRepromptOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(26,13,46,.6)", zIndex: 199 }} />}
                <div className="pixel" style={{
                  background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: 14, zIndex: 200,
                  ...(isMobile
                    ? { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(340px,92vw)" }
                    : { position: "absolute", top: "calc(100% + 8px)", right: 0, width: 300 }),
                }}>
                  <div style={{ fontSize: 8, color: C.dim2, marginBottom: 8 }}>RE-CLIP THIS VIDEO — NO REPROCESSING</div>
                  <input value={repromptFind} onChange={e => setRepromptFind(e.target.value)}
                    placeholder="find: e.g. moments about money"
                    className="mono" style={{ width: "100%", padding: "9px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 12, marginBottom: 8 }} />
                  <input value={repromptExclude} onChange={e => setRepromptExclude(e.target.value)}
                    placeholder="exclude: e.g. intros, sponsors"
                    className="mono" style={{ width: "100%", padding: "9px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 12, marginBottom: 10 }} />
                  <button onClick={openCamPicker} className="pixel"
                    style={{ width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 8, cursor: "pointer",
                      background: camBox ? C.signal : C.cream2, color: C.ink,
                      border: `2px solid ${C.ink}${camOpen ? "" : "33"}`, marginBottom: 8 }}>
                    {camBox ? "✓ CAM BOX SET (click to adjust)" : "▦ FIX CAM BOX (wrong facecam? draw it)"}
                  </button>
                  {camOpen && camFrameUrl && (
                    <div style={{ marginBottom: 10 }}>
                      <div ref={camImgRef}
                        onMouseDown={camDown} onMouseMove={camMove} onMouseUp={camUp} onMouseLeave={camUp}
                        onTouchStart={camDown} onTouchMove={camMove} onTouchEnd={camUp}
                        style={{ position: "relative", cursor: "crosshair", userSelect: "none", touchAction: "none",
                          backgroundImage: `url(${camFrameUrl})`, backgroundSize: "cover",
                          width: "100%", aspectRatio: "16/9", border: BORDER }}>
                        {camBox && camBox.w > 0 && (
                          <div style={{ position: "absolute",
                            left: `${camBox.x * 100}%`, top: `${camBox.y * 100}%`,
                            width: `${camBox.w * 100}%`, height: `${camBox.h * 100}%`,
                            border: "2px solid #2BFF00", background: "#2BFF0022", pointerEvents: "none" }} />
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                        <span className="vt" style={{ fontSize: 12, color: C.dim2 }}>drag a box around the facecam</span>
                        {camBox && <button onClick={() => setCamBox(null)} className="pixel"
                          style={{ background: "transparent", color: C.dim, fontSize: 8, cursor: "pointer" }}>CLEAR</button>}
                      </div>
                    </div>
                  )}
                  {repromptError && <div className="vt" style={{ fontSize: 13, color: C.hotDeep, marginBottom: 8 }}>{repromptError}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <PixelBtn color="signal" size="sm" onClick={handleReprompt} disabled={reprompting}>
                      {reprompting ? "..." : "> GO"}
                    </PixelBtn>
                    <PixelBtn color="cream" size="sm" onClick={() => setRepromptOpen(false)}>CANCEL</PixelBtn>
                  </div>
                </div>
                </>
              )}
            </div>
            <PixelBtn color="peach" size={isMobile ? "sm" : "md"} onClick={() => setEditTarget({ clipIndex: null })}>
              {isMobile ? "✂ CREATE" : "✂ CREATE CLIP"}
            </PixelBtn>
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
              ttConnected={ttConnected}
              ttAccounts={ttAccounts}
              isActive={active?.path === c.path}
              onPreview={() => setActive(prev => prev?.path === c.path ? null : c)}
              onYTUpload={() => onYTUpload(c, i)}
              onTTUpload={() => onTTUpload(c, i)}
              onEdit={() => setEditTarget({ clipIndex: i, title: c.title })}
              jobId={job.job_id}
              isPro={isPro}
            />
          ))}
          {clips.length === 0 && (
            <PixelCard color={C.cream} padding={32} style={{ textAlign: "center" }}>
              <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>No clips were generated. Try a different video.</p>
            </PixelCard>
          )}
        </div>

        {editTarget && (
          <EditClipModal
            jobId={job.job_id}
            clipIndex={editTarget.clipIndex}
            clipTitle={editTarget.title}
            onClose={() => setEditTarget(null)}
            onRendered={(childId) => { navigate(`/work?job=${childId}`); window.location.reload(); }}
          />
        )}

        {!isMobile && active && (
          <div ref={previewRef} style={{ position: "sticky", top: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="pixel" style={{ fontSize: 9, color: C.dim2 }}>NOW PREVIEWING</div>
              <button onClick={() => setActive(null)} className="pixel" style={{ padding: "4px 8px", fontSize: 9, background: C.cream, border: BORDER_SM, boxShadow: `2px 2px 0 ${C.ink}`, cursor: "pointer" }}>x</button>
            </div>
            <div style={{ background: C.windowBg, border: BORDER, boxShadow: SHADOW, padding: 0, overflow: "hidden" }}>
              <div style={{ aspectRatio: "9/16", background: C.windowBg, position: "relative" }}>
                <video src={active.presigned_url || activeToken} poster={active.thumbnail_url || undefined} controls autoPlay preload="auto" style={{ width: "100%", height: "100%", display: "block", background: "#000" }} />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <Tag bg={C.cream}>CLIP {String((clips.indexOf(active)) + 1).padStart(2, "0")}</Tag>
              <p className="vt" style={{ fontSize: 18, color: C.ink, marginTop: 10, lineHeight: 1.35 }}>{active.hook || active.title}</p>
            </div>
          </div>
        )}
      </div>

      {clips.length > 0 && <RetentionNotice job={job} isMobile={isMobile} />}
    </div>
  );
}

function RetentionNotice({ job, isMobile }) {
  const RETENTION_DAYS = 7;
  if (job.clips_expired) {
    return (
      <PixelCard color={C.hot} padding={isMobile ? 14 : 18} style={{ marginTop: 24, boxShadow: isMobile ? "none" : undefined }}>
        <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 8 }}>⚠ CLIPS EXPIRED</div>
        <div className="vt" style={{ fontSize: isMobile ? 15 : 17, color: C.ink, lineHeight: 1.5 }}>
          These clips were older than {RETENTION_DAYS} days and have been removed from storage. Re-run the job to regenerate them.
        </div>
      </PixelCard>
    );
  }
  let daysLeft = null;
  if (job.created_at) {
    const elapsed = (Date.now() - new Date(job.created_at).getTime()) / 86400000;
    daysLeft = Math.max(0, Math.ceil(RETENTION_DAYS - elapsed));
  }
  return (
    <PixelCard color={C.amber} padding={isMobile ? 14 : 18} style={{ marginTop: 24, boxShadow: isMobile ? "none" : undefined }}>
      <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 8 }}>⏳ HEADS UP</div>
      <div className="vt" style={{ fontSize: isMobile ? 15 : 17, color: C.ink, lineHeight: 1.5 }}>
        Clips are auto-deleted {RETENTION_DAYS} days after creation
        {daysLeft !== null && <> — <strong>{daysLeft === 0 ? "expiring today" : `about ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</strong></>}.
        Download anything you want to keep before then.
      </div>
    </PixelCard>
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
  const { isPro, ytStatus, ttStatus, setJobActive } = useApp();
  const isMobileWP = useMobile();

  const [job, setJob] = useState(null);
  const [ytModal, setYtModal] = useState(null);
  const [ttModal, setTtModal] = useState(null);
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

  const handleUploadAll = async (channelId) => {
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
          body: JSON.stringify({
            title, description, tags: clip.tags || [], privacy_status: "public",
            yt_channel_id: channelId || undefined,
          }),
        });
      } catch {}
      await new Promise(r => setTimeout(r, 1500));
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

  const handleUploadAllTikTok = async (account) => {
    if (!job?.clips || uploadingAll) return;
    setUploadingAll(true);
    clearInterval(uploadAllPollRef.current);
    const toUpload = job.clips
      .map((c, i) => ({ clip: c, idx: i }))
      .filter(({ clip }) => !clip.tt_upload || !["done", "uploading", "queued"].includes(clip.tt_upload?.status));
    for (const { clip, idx } of toUpload) {
      try {
        await authFetch(`/api/tiktok/upload/${jobId}/${idx}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tt_open_id: account || undefined }),
        });
      } catch {}
      await new Promise(r => setTimeout(r, 1500));
    }
    uploadAllPollRef.current = setInterval(async () => {
      const d = await fetchJob(jobId);
      if (!d) return;
      setJob(d);
      const allSettled = (d.clips || []).every(c => !c.tt_upload || ["done", "error"].includes(c.tt_upload?.status));
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
        <div style={{ padding: isMobileWP ? "24px 16px" : "64px 32px", maxWidth: 1320, margin: "0 auto" }}>
          <PixelCard color={C.cream} padding={isMobileWP ? 28 : 48} style={{ textAlign: "center" }}>
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
        <div className="fade" style={{ padding: isMobileWP ? "24px 16px" : "64px 32px", maxWidth: 1320, margin: "0 auto" }}>
          <PixelCard color={C.hot} padding={isMobileWP ? 24 : 48} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 11, color: C.ink, marginBottom: 14 }}>! JOB NOT FOUND</div>
            <h2 className="pixel" style={{ fontSize: isMobileWP ? 18 : 22, color: C.ink, marginBottom: 18 }}>Could not load this job.</h2>
            <p className="vt" style={{ fontSize: 18, color: C.ink, marginBottom: 24 }}>It may have expired or the server is unreachable.</p>
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
        <div className="fade" style={{ padding: isMobileWP ? "24px 16px" : "64px 32px", maxWidth: 1320, margin: "0 auto" }}>
          <PixelCard color={C.cream} padding={isMobileWP ? 24 : 48} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 11, color: C.dim2, marginBottom: 14 }}>NO ACTIVE JOB</div>
            <h2 className="pixel" style={{ fontSize: isMobileWP ? 18 : 22, color: C.ink, marginBottom: 18 }}>The forge is cold.</h2>
            <p className="vt" style={{ fontSize: 18, color: C.dim2, marginBottom: 24 }}>Start a new clip to fire it up.</p>
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
        <div className="fade" style={{ padding: isMobileWP ? "16px 16px 48px" : "32px 32px 64px", maxWidth: 920, margin: "0 auto" }}>
          <PixelCard color={C.amber} padding={isMobileWP ? 20 : 32} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 11, color: C.ink, marginBottom: 12 }}>JOB CANCELLED</div>
            <p className="pixel" style={{ fontSize: isMobileWP ? 11 : 14, color: C.ink, lineHeight: 1.5, marginBottom: 24 }}>The job was stopped. Any temp files have been cleaned up.</p>
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
        <div className="fade" style={{ padding: isMobileWP ? "16px 16px 48px" : "32px 32px 64px", maxWidth: 920, margin: "0 auto" }}>
          <PixelCard color={C.hot} padding={isMobileWP ? 20 : 32} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 11, color: C.ink, marginBottom: 12 }}>! JOB FAILED</div>
            <p className="pixel" style={{ fontSize: isMobileWP ? 11 : 14, color: C.ink, lineHeight: 1.5, marginBottom: 24 }}>
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
          ttStatus={ttStatus}
          isPro={isPro}
          onNew={goNew}
          onYTUpload={(clip, clipIndex) => setYtModal({ clip, clipIndex })}
          onTTUpload={(clip, clipIndex) => setTtModal({ clip, clipIndex })}
          onUploadAll={handleUploadAll}
          onUploadAllTikTok={handleUploadAllTikTok}
          uploadingAll={uploadingAll}
        />
        {ytModal && (
          <YouTubeUploadModal
            clip={ytModal.clip}
            clipIndex={ytModal.clipIndex}
            jobId={jobId}
            ytChannels={ytStatus?.channels || []}
            onClose={() => setYtModal(null)}
            onUploaded={refreshJob}
          />
        )}
        {ttModal && (
          <TikTokUploadModal
            clip={ttModal.clip}
            clipIndex={ttModal.clipIndex}
            jobId={jobId}
            ttAccounts={ttStatus?.accounts || []}
            onClose={() => setTtModal(null)}
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
