import { useState, useEffect } from "react";
import { C, BORDER, BORDER_SM, SHADOW, SHADOW_SM, KEYFRAMES, timeAgo } from "../lib/theme";
import { PixelBtn, PixelCard } from "../components/ui";
import Header from "../components/Header";
import { authFetch } from "../lib/supabase";
import { useApp } from "../context/AppContext";
import { useMobile } from "../hooks/useMobile";

const DAY_OPTIONS = [
  { value: 30,  label: "30 days back" },
  { value: 60,  label: "60 days back" },
  { value: 90,  label: "90 days back" },
  { value: 180, label: "6 months back" },
  { value: 365, label: "1 year back" },
];
const VPD_OPTIONS = [
  { value: 1, color: C.signal },
  { value: 2, color: C.amber },
  { value: 3, color: C.peach },
  { value: 5, color: C.hot },
];
const CAPTION_STYLES = [
  { id: "bold_bottom", label: "BOLD",    hint: "white + yellow, bottom", bg: C.amber    },
  { id: "center_pop",  label: "POP",     hint: "large, centered",         bg: C.lavender },
  { id: "minimal",     label: "MINIMAL", hint: "small, clean",            bg: C.signal   },
];
const CAPTION_FONT_DEFAULTS = { bold_bottom: 72, center_pop: 88, minimal: 56 };
const HIGHLIGHT_SWATCHES = [
  { color: null,      label: "AUTO", bg: C.cream2,  fg: C.dim2 },
  { color: "#FFD400", label: "YLW",  bg: "#FFD400", fg: "#222" },
  { color: "#00FFFF", label: "CYN",  bg: "#00FFFF", fg: "#222" },
  { color: "#FF4500", label: "ORG",  bg: "#FF4500", fg: "#fff" },
  { color: "#FF69B4", label: "PNK",  bg: "#FF69B4", fg: "#222" },
  { color: "#00FF88", label: "GRN",  bg: "#00FF88", fg: "#222" },
  { color: "#FFFFFF", label: "WHT",  bg: "#FFFFFF", fg: "#555" },
];
const CAPTION_LANGUAGES = [
  { code: "source", label: "Source (no translation)" },
  { code: "en", label: "English" }, { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" }, { code: "it", label: "Italian" },
  { code: "hi", label: "Hindi" },   { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" }, { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },  { code: "ru", label: "Russian" },
];

function ProgressBar({ value, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 10, background: C.cream2, border: BORDER, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: C.signal, transition: "width .4s" }} />
      </div>
      <span className="pixel" style={{ fontSize: 8, color: C.dim2, flexShrink: 0 }}>{value}/{max}</span>
    </div>
  );
}

function Stepper({ label, val, onAdj, min, max, step, suffix = "" }) {
  return (
    <div>
      <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", border: BORDER_SM, boxShadow: `2px 2px 0 ${C.ink}`, background: C.paper }}>
        <button onClick={() => onAdj(-step)} className="pixel"
          style={{ width: 26, padding: "6px 0", background: "transparent", borderRight: `2px solid ${C.ink}`, fontSize: 12, cursor: val > min ? "pointer" : "not-allowed", color: val > min ? C.ink : C.dim }}>-</button>
        <div className="pixel" style={{ flex: 1, textAlign: "center", padding: "6px 4px", fontSize: 10, color: C.ink, minWidth: 36 }}>{val}{suffix}</div>
        <button onClick={() => onAdj(+step)} className="pixel"
          style={{ width: 26, padding: "6px 0", background: "transparent", borderLeft: `2px solid ${C.ink}`, fontSize: 12, cursor: val < max ? "pointer" : "not-allowed", color: val < max ? C.ink : C.dim }}>+</button>
      </div>
    </div>
  );
}

function DigestCard({ bf, ytStatus, onRemove, onRunNow, onPatch, isMobile }) {
  const isCompleted = bf.status === "completed";
  const processed   = (bf.processed_video_ids || []).length;
  const total       = bf.total_videos || 0;

  const [daysBack,       setDaysBack]       = useState(bf.days_back ?? 30);
  const [videosPerDay,   setVideosPerDay]   = useState(bf.videos_per_day ?? 2);
  const [ytChannelId,    setYtChannelId]    = useState(bf.yt_upload_channel_id ?? "");
  const [autoUpload,     setAutoUpload]     = useState(bf.auto_upload ?? false);
  const [maxClips,       setMaxClips]       = useState(bf.max_clips ?? 3);
  const [minDur,         setMinDur]         = useState(bf.min_duration ?? 30);
  const [maxDur,         setMaxDur]         = useState(bf.max_duration ?? 90);
  const [captionOpen,    setCaptionOpen]    = useState(false);
  const [captionStyle,   setCaptionStyle]   = useState(bf.caption_style ?? "bold_bottom");
  const [fontSize,       setFontSize]       = useState(bf.caption_font_size ?? null);
  const [highlightColor, setHighlightColor] = useState(bf.caption_highlight_color ?? null);
  const [captionLang,    setCaptionLang]    = useState(bf.caption_language ?? "source");
  const [bgMusicUrl,     setBgMusicUrl]     = useState(bf.bg_music_url ?? "");
  const [bgMusicVolume,  setBgMusicVolume]  = useState(bf.bg_music_volume ?? 0.15);

  const ytChannels = ytStatus?.channels || [];
  const effectiveFontSize = fontSize ?? CAPTION_FONT_DEFAULTS[captionStyle] ?? 72;

  const patch = (fields) => onPatch(bf.id, fields);
  const adj = (val, setVal, min, max, delta, field) => {
    const next = Math.min(max, Math.max(min, val + delta));
    setVal(next);
    patch({ [field]: next });
  };

  return (
    <PixelCard color={isCompleted ? C.signal : C.cream} padding={0} style={isMobile ? { boxShadow: "none" } : {}}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) auto", alignItems: "stretch" }}>

        {/* Left: info + controls */}
        <div style={{ padding: isMobile ? "16px" : "20px 22px", borderRight: isMobile ? "none" : BORDER, borderBottom: isMobile ? BORDER : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap", minWidth: 0 }}>
            <span className="pixel" style={{ fontSize: 11, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: isMobile ? "60vw" : "none" }}>
              * {bf.channel_name || bf.channel_url}
            </span>
            {isCompleted && (
              <span className="pixel" style={{ fontSize: 7, background: C.signalDeep, color: C.cream, padding: "3px 7px", border: BORDER }}>DONE</span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 11, color: C.dim2, marginBottom: 12, wordBreak: "break-all" }}>{bf.channel_url}</div>

          {isCompleted ? (
            <div className="vt" style={{ fontSize: isMobile ? 14 : 16, color: C.signalDeep }}>
              All {total} videos from the {bf.days_back}-day window have been clipped and posted!
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}><ProgressBar value={processed} max={total || processed + 1} /></div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: isMobile ? 8 : 10 }}>
                <Stepper label="MAX CLIPS" val={maxClips} min={1} max={10} step={1}
                  onAdj={d => adj(maxClips, setMaxClips, 1, 10, d, "max_clips")} />
                <Stepper label="MIN DUR" val={minDur} min={15} max={120} step={5} suffix="s"
                  onAdj={d => adj(minDur, setMinDur, 15, 120, d, "min_duration")} />
                <Stepper label="MAX DUR" val={maxDur} min={30} max={180} step={10} suffix="s"
                  onAdj={d => adj(maxDur, setMaxDur, 30, 180, d, "max_duration")} />
              </div>

              <div style={{ marginTop: 14 }}>
                <button onClick={() => setCaptionOpen(o => !o)} className="pixel"
                  style={{ fontSize: 8, color: C.ink, background: captionOpen ? C.lavender : C.cream2,
                    cursor: "pointer", padding: "8px 12px", border: BORDER,
                    boxShadow: captionOpen ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
                    transform: captionOpen ? "translate(2px,2px)" : "none",
                    display: "flex", alignItems: "center", gap: 6, transition: "all .1s" }}>
                  <span style={{ fontSize: 10 }}>Aa</span>
                  CAPTION SETTINGS {captionOpen ? "▲" : "▼"}
                </button>
              </div>

              {captionOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `2px dashed ${C.ink}22` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: isMobile ? 6 : 8, marginBottom: 14 }}>
                    {CAPTION_STYLES.map(({ id, label, hint, bg }) => (
                      <button key={id} onClick={() => { setCaptionStyle(id); patch({ caption_style: id }); }} className="pixel"
                        style={{ textAlign: "left", padding: "10px 8px",
                          background: captionStyle === id ? bg : C.paper,
                          border: captionStyle === id ? `3px solid ${C.ink}` : BORDER,
                          boxShadow: captionStyle === id ? SHADOW : SHADOW_SM,
                          cursor: "pointer", transition: "all .12s" }}>
                        <div style={{ fontSize: 9, color: C.ink, marginBottom: 2 }}>{label}</div>
                        <div className="vt" style={{ fontSize: 11, color: C.dim2, letterSpacing: 0, textTransform: "none", lineHeight: 1.2 }}>{hint}</div>
                      </button>
                    ))}
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>LANGUAGE</div>
                    <select value={captionLang} onChange={e => { setCaptionLang(e.target.value); patch({ caption_language: e.target.value }); }}
                      className="mono" style={{ width: "100%", padding: "8px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 12, cursor: "pointer" }}>
                      {CAPTION_LANGUAGES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>FONT SIZE</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                        <div style={{ flex: 1 }}>
                          <Stepper label="" val={effectiveFontSize} min={40} max={120} step={4} suffix="px"
                            onAdj={d => { const v = Math.min(120, Math.max(40, effectiveFontSize + d)); setFontSize(v); patch({ caption_font_size: v }); }} />
                        </div>
                        <button onClick={() => { setFontSize(null); patch({ caption_font_size: null }); }} className="pixel"
                          style={{ padding: "6px 10px", fontSize: 8, cursor: "pointer",
                            background: fontSize === null ? C.signal : C.cream2, color: C.ink, border: BORDER,
                            boxShadow: fontSize === null ? `2px 2px 0 ${C.ink}` : SHADOW_SM }}>AUTO</button>
                      </div>
                    </div>
                    <div>
                      <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>HIGHLIGHT</div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {HIGHLIGHT_SWATCHES.map(({ color, label, bg, fg }) => (
                          <button key={label} onClick={() => { setHighlightColor(color); patch({ caption_highlight_color: color }); }} className="pixel"
                            style={{ padding: "5px 8px", fontSize: 7, background: bg, color: fg,
                              border: highlightColor === color ? `2px solid ${C.ink}` : `2px solid ${C.ink}33`,
                              boxShadow: highlightColor === color ? `2px 2px 0 ${C.ink}` : "none",
                              cursor: "pointer", transition: "all .1s" }}>{label}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: `2px dashed ${C.ink}22` }}>
                    <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontFamily: "sans-serif" }}>🎵</span> BACKGROUND MUSIC <span style={{ color: C.dim }}>(optional)</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: C.paper, border: BORDER, marginBottom: 8 }}>
                      <span className="pixel" style={{ fontSize: 9, color: C.dim, flexShrink: 0 }}>{`>`}</span>
                      <input value={bgMusicUrl} onChange={e => setBgMusicUrl(e.target.value)}
                        onBlur={() => patch({ bg_music_url: bgMusicUrl.trim() || null })}
                        placeholder="paste a YouTube music URL"
                        className="mono" style={{ flex: 1, background: "transparent", color: C.ink, fontSize: 11, fontWeight: 500, minWidth: 0, outline: "none", border: "none" }} />
                    </div>
                    {bgMusicUrl.trim() && (
                      <div style={{ display: "flex", gap: 5 }}>
                        {[["Quiet", 0.08], ["Soft", 0.15], ["Med", 0.30], ["Loud", 0.50]].map(([label, vol]) => (
                          <button key={label} onClick={() => { setBgMusicVolume(vol); patch({ bg_music_volume: vol }); }} className="pixel" style={{
                            flex: 1, padding: "6px 4px", fontSize: 7, cursor: "pointer",
                            background: bgMusicVolume === vol ? C.signal : C.cream2, color: C.ink, border: BORDER,
                            boxShadow: bgMusicVolume === vol ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
                            transform: bgMusicVolume === vol ? "translate(2px,2px)" : "none",
                          }}>{label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: pace/channel/actions */}
        <div style={{ padding: isMobile ? "12px 16px" : "20px 18px", display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", minWidth: isMobile ? "auto" : 180 }}>

          {/* Auto upload toggle */}
          <button onClick={() => { setAutoUpload(v => { const next = !v; patch({ auto_upload: next }); return next; }); }}
            className="pixel" style={{
              padding: "10px 12px", fontSize: 8, textAlign: "center", width: "100%",
              background: autoUpload ? C.signal : C.cream2, color: C.ink, border: BORDER,
              boxShadow: autoUpload ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
              transform: autoUpload ? "translate(2px,2px)" : "none",
              cursor: "pointer", transition: "all .1s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <span style={{ fontSize: 14, fontFamily: "sans-serif" }}>🎉</span>
            {autoUpload ? "AUTO-UPLOAD ON" : "AUTO-UPLOAD OFF"}
          </button>

          {/* Look back */}
          <div>
            <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 5 }}>LOOK BACK</div>
            <select value={daysBack} onChange={e => { setDaysBack(Number(e.target.value)); patch({ days_back: Number(e.target.value) }); }}
              className="pixel" style={{ width: "100%", padding: "7px 8px", background: C.paper, color: C.ink, border: BORDER, fontSize: 7 }}>
              {DAY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>

          {/* Videos per day */}
          <div>
            <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 5 }}>VIDEOS / DAY</div>
            <div style={{ display: "flex", gap: 4 }}>
              {VPD_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => { setVideosPerDay(opt.value); patch({ videos_per_day: opt.value }); }} className="pixel" style={{
                  flex: 1, padding: "6px 0", fontSize: 8,
                  background: videosPerDay === opt.value ? opt.color : C.cream2,
                  color: C.ink, border: BORDER,
                  boxShadow: videosPerDay === opt.value ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
                  transform: videosPerDay === opt.value ? "translate(2px,2px)" : "none",
                  cursor: "pointer",
                }}>{opt.value}</button>
              ))}
            </div>
          </div>

          {/* YT channel */}
          {ytChannels.length > 0 && (
            <div>
              <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 5 }}>UPLOAD TO</div>
              {ytChannels.length === 1 ? (
                <div className="pixel" style={{ fontSize: 7, padding: "7px 8px", background: C.yt, border: BORDER, color: C.ink }}>
                  * {ytChannels[0].yt_channel_name || "YouTube"}
                </div>
              ) : (
                <select value={ytChannelId}
                  onChange={e => { setYtChannelId(e.target.value); patch({ yt_upload_channel_id: e.target.value }); }}
                  className="pixel" style={{ width: "100%", padding: "7px 8px", background: C.paper, color: C.ink, border: BORDER, fontSize: 7 }}>
                  {ytChannels.map(c => <option key={c.yt_channel_id} value={c.yt_channel_id}>{c.yt_channel_name || c.yt_channel_id}</option>)}
                </select>
              )}
            </div>
          )}

          {!isCompleted && (
            <PixelBtn color="amber" size="sm" onClick={() => onRunNow(bf.id)}>RUN NOW</PixelBtn>
          )}
          <PixelBtn color="hot" size="sm" onClick={() => onRemove(bf.id)}>REMOVE</PixelBtn>
        </div>
      </div>
    </PixelCard>
  );
}

export default function DigestPage() {
  const { ytStatus, isPro } = useApp();
  const isMobile = useMobile();
  const [backfills, setBackfills] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [adding, setAdding]     = useState(false);
  const [addError, setAddError] = useState("");
  const [urlInput, setUrlInput] = useState("");

  const fetchBackfills = async () => {
    try {
      const res = await authFetch("/api/backfill");
      const data = await res.json();
      setBackfills(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    fetchBackfills();
    const i = setInterval(fetchBackfills, 15000);
    return () => clearInterval(i);
  }, []);

  const handleAdd = async () => {
    if (!urlInput.trim()) return;
    setAdding(true); setAddError("");
    try {
      const res = await authFetch("/api/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_url: urlInput.trim() }),
      });
      if (!res.ok) { const d = await res.json(); setAddError(d.detail || "Failed to add channel"); }
      else { setUrlInput(""); fetchBackfills(); }
    } catch { setAddError("Cannot reach server."); }
    setAdding(false);
  };

  const handleRemove = async (id) => {
    if (!window.confirm("Remove this digest channel?")) return;
    await authFetch(`/api/backfill/${id}`, { method: "DELETE" });
    fetchBackfills();
  };

  const handleRunNow = async (id) => {
    await authFetch(`/api/backfill/${id}/run`, { method: "POST" });
    fetchBackfills();
  };

  const handlePatch = async (id, updates) => {
    await authFetch(`/api/backfill/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  };

  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <div className="fade" style={{ padding: isMobile ? "16px 12px" : "64px 32px", maxWidth: 1320, margin: "0 auto", textAlign: "center" }}>
          <div className="pixel" style={{ fontSize: 11, color: C.dim2, marginBottom: 16 }}>PRO ONLY</div>
          <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Upgrade to Pro to use Channel Digest.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto" }}>

        <div style={{ marginBottom: 24 }}>
          <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }}>DIGEST</div>
          <h1 className="pixel" style={{ fontSize: isMobile ? 18 : 26, color: C.ink }}>Channel digest.</h1>
          <p className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 6 }}>
            Add a channel — ClipForge works through its backlog a few videos per day.
          </p>
        </div>

        {/* Add form — URL + button only, just like watchlist */}
        <PixelCard color={C.cream} padding={22} style={{ marginBottom: 24, boxShadow: isMobile ? "none" : undefined }}>
          <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 12 }}>ADD CHANNEL</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: isMobile ? 0 : 260, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: C.paper, border: BORDER, boxShadow: SHADOW_SM }}>
              <span className="pixel" style={{ fontSize: 12, color: C.dim }}>{`>`}</span>
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="https://youtube.com/@channel or /channel/UCxxx"
                className="mono" style={{ flex: 1, background: "transparent", color: C.ink, fontSize: 13, fontWeight: 500, minWidth: 0 }} />
            </div>
            <PixelBtn color="hot" onClick={handleAdd} disabled={adding || !urlInput.trim()}>
              {adding ? "RESOLVING..." : "+ ADD"}
            </PixelBtn>
          </div>
          {addError && (
            <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginTop: 10, padding: "8px 10px", background: `${C.hot}44`, border: `2px solid ${C.hotDeep}` }}>
              ! {addError}
            </div>
          )}
        </PixelCard>

        {/* Channel list */}
        {loading ? (
          <PixelCard color={C.paper} padding={48} style={{ textAlign: "center", boxShadow: isMobile ? "none" : undefined }}>
            <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Loading...</p>
          </PixelCard>
        ) : backfills.length === 0 ? (
          <PixelCard color={C.paper} padding={48} style={{ textAlign: "center", boxShadow: isMobile ? "none" : undefined }}>
            <div className="pixel" style={{ fontSize: 11, color: C.dim2, marginBottom: 10 }}>NO CHANNELS</div>
            <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Add a YouTube channel URL above to start digesting its backlog.</p>
          </PixelCard>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {backfills.map(bf => (
              <DigestCard key={bf.id} bf={bf} ytStatus={ytStatus}
                onRemove={handleRemove} onRunNow={handleRunNow} onPatch={handlePatch} isMobile={isMobile} />
            ))}
          </div>
        )}

        {/* Tips — same style as watchlist */}
        <PixelCard color={C.lavender} padding={18} style={{ marginTop: 24, boxShadow: isMobile ? "none" : undefined }}>
          <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 8 }}>HOW IT WORKS</div>
          <div className="vt" style={{ fontSize: 17, color: C.ink, lineHeight: 1.5 }}>
            ClipForge processes a few videos per day from a channel's backlog until all are done.<br />
            Set <strong>LOOK BACK</strong> to control how far back in the channel's history to go.<br />
            <strong>VIDEOS / DAY</strong> controls the daily pace. Clips are auto-uploaded if a YouTube channel is selected.
          </div>
        </PixelCard>
      </div>
    </div>
  );
}
