import { useState, useEffect } from "react";
import { C, BORDER, BORDER_SM, SHADOW_SM, KEYFRAMES, timeAgo } from "../lib/theme";
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
  { id: "bold_bottom", label: "BOLD",    bg: C.amber    },
  { id: "center_pop",  label: "POP",     bg: C.lavender },
  { id: "minimal",     label: "MINIMAL", bg: C.signal   },
];
const CAPTION_FONT_DEFAULTS = { bold_bottom: 72, center_pop: 88, minimal: 56 };
const HIGHLIGHT_SWATCHES = [
  { color: null,      label: "AUTO", bg: C.cream2,  fg: C.dim2  },
  { color: "#FFD400", label: "YLW",  bg: "#FFD400", fg: "#222"  },
  { color: "#00FFFF", label: "CYN",  bg: "#00FFFF", fg: "#222"  },
  { color: "#FF4500", label: "ORG",  bg: "#FF4500", fg: "#fff"  },
  { color: "#FF69B4", label: "PNK",  bg: "#FF69B4", fg: "#222"  },
  { color: "#00FF88", label: "GRN",  bg: "#00FF88", fg: "#222"  },
  { color: "#FFFFFF", label: "WHT",  bg: "#FFFFFF", fg: "#555"  },
];
const CAPTION_LANGUAGES = [
  { code: "source", label: "Source" },
  { code: "en", label: "English" }, { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" }, { code: "it", label: "Italian" },
  { code: "hi", label: "Hindi" },   { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" }, { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },  { code: "ru", label: "Russian" },
];
const MAX_CLIPS_OPTIONS = [1, 2, 3, 5, 10];

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

function Stepper({ label, val, setVal, min, max, step, onCommit, suffix = "" }) {
  const adj = (delta) => {
    const next = Math.min(max, Math.max(min, val + delta));
    setVal(next);
    onCommit(next);
  };
  return (
    <div>
      <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", border: BORDER_SM, boxShadow: `2px 2px 0 ${C.ink}`, background: C.paper }}>
        <button onClick={() => adj(-step)} className="pixel"
          style={{ width: 26, padding: "6px 0", background: "transparent", borderRight: `2px solid ${C.ink}`, fontSize: 12, cursor: val > min ? "pointer" : "not-allowed", color: val > min ? C.ink : C.dim }}>-</button>
        <div className="pixel" style={{ flex: 1, textAlign: "center", padding: "6px 4px", fontSize: 10, color: C.ink, minWidth: 36 }}>{val}{suffix}</div>
        <button onClick={() => adj(+step)} className="pixel"
          style={{ width: 26, padding: "6px 0", background: "transparent", borderLeft: `2px solid ${C.ink}`, fontSize: 12, cursor: val < max ? "pointer" : "not-allowed", color: val < max ? C.ink : C.dim }}>+</button>
      </div>
    </div>
  );
}

function ClipSettings({ vals, onChange, isMobile }) {
  const { captionStyle, fontSize, highlightColor, captionLang, maxClips } = vals;
  const effectiveSize = fontSize ?? CAPTION_FONT_DEFAULTS[captionStyle] ?? 72;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "14px 0 4px" }}>
      {/* Max clips */}
      <div>
        <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>CLIPS PER VIDEO</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MAX_CLIPS_OPTIONS.map(n => (
            <button key={n} onClick={() => onChange("maxClips", n)} className="pixel" style={{
              padding: "7px 12px", fontSize: 8,
              background: maxClips === n ? C.lavender : C.cream2,
              color: C.ink, border: BORDER,
              boxShadow: maxClips === n ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
              transform: maxClips === n ? "translate(2px,2px)" : "none",
              cursor: "pointer",
            }}>{n}</button>
          ))}
        </div>
      </div>

      {/* Caption style */}
      <div>
        <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>CAPTION STYLE</div>
        <div style={{ display: "flex", gap: 6 }}>
          {CAPTION_STYLES.map(s => (
            <button key={s.id} onClick={() => onChange("captionStyle", s.id)} className="pixel" style={{
              flex: isMobile ? 1 : "0 0 auto",
              padding: "7px 10px", fontSize: 8,
              background: captionStyle === s.id ? s.bg : C.cream2,
              color: C.ink, border: BORDER,
              boxShadow: captionStyle === s.id ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
              transform: captionStyle === s.id ? "translate(2px,2px)" : "none",
              cursor: "pointer",
            }}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* Font size + language */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>FONT SIZE</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Stepper label="" val={effectiveSize} setVal={() => {}} min={32} max={120} step={4} suffix="px"
              onCommit={v => onChange("fontSize", v)} />
            <button onClick={() => onChange("fontSize", null)} className="pixel" style={{
              padding: "6px 9px", fontSize: 7, background: fontSize === null ? C.amber : C.cream2,
              color: C.ink, border: BORDER, cursor: "pointer",
              boxShadow: fontSize === null ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
              transform: fontSize === null ? "translate(2px,2px)" : "none",
            }}>AUTO</button>
          </div>
        </div>

        <div>
          <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>LANGUAGE</div>
          <select value={captionLang} onChange={e => onChange("captionLang", e.target.value)} className="pixel"
            style={{ padding: "8px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 8 }}>
            {CAPTION_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {/* Highlight color */}
      <div>
        <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>HIGHLIGHT COLOR</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {HIGHLIGHT_SWATCHES.map(sw => (
            <button key={sw.label} onClick={() => onChange("highlightColor", sw.color)} className="pixel" style={{
              padding: "5px 8px", fontSize: 7, background: sw.bg, color: sw.fg, border: BORDER, cursor: "pointer",
              boxShadow: highlightColor === sw.color ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
              transform: highlightColor === sw.color ? "translate(2px,2px)" : "none",
            }}>{sw.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DigestCard({ bf, ytStatus, onRemove, onRunNow, onPatch, isMobile }) {
  const isCompleted = bf.status === "completed";
  const processed = (bf.processed_video_ids || []).length;
  const total = bf.total_videos || 0;
  const ytChannel = (ytStatus?.channels || []).find(c => c.yt_channel_id === bf.yt_upload_channel_id);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [captionStyle, setCaptionStyle]     = useState(bf.caption_style || "bold_bottom");
  const [fontSize, setFontSize]             = useState(bf.caption_font_size ?? null);
  const [highlightColor, setHighlightColor] = useState(bf.caption_highlight_color ?? null);
  const [captionLang, setCaptionLang]       = useState(bf.caption_language || "source");
  const [maxClips, setMaxClips]             = useState(bf.max_clips || 3);

  const handleChange = (key, value) => {
    const map = {
      captionStyle:   [setCaptionStyle,   "caption_style"],
      fontSize:       [setFontSize,       "caption_font_size"],
      highlightColor: [setHighlightColor, "caption_highlight_color"],
      captionLang:    [setCaptionLang,    "caption_language"],
      maxClips:       [setMaxClips,       "max_clips"],
    };
    const [setter, field] = map[key];
    setter(value);
    onPatch(bf.id, { [field]: value });
  };

  return (
    <PixelCard color={isCompleted ? C.signal : C.cream} padding={0} style={{ overflow: "hidden" }}>
      <div style={{ padding: isMobile ? "14px 14px 10px" : "18px 20px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <span className="pixel" style={{ fontSize: isMobile ? 9 : 11, color: C.ink, wordBreak: "break-word", flex: 1 }}>
            * {bf.channel_name || bf.channel_url}
          </span>
          {isCompleted && (
            <span className="pixel" style={{ fontSize: 7, background: C.signalDeep, color: C.cream, padding: "3px 7px", border: BORDER, flexShrink: 0 }}>DONE</span>
          )}
        </div>

        <div className="mono" style={{ fontSize: 10, color: C.dim2, marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {bf.channel_url}
        </div>

        <div className="pixel" style={{ fontSize: 7, color: C.dim, marginBottom: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>{DAY_OPTIONS.find(d => d.value === bf.days_back)?.label || `${bf.days_back}d back`}</span>
          <span>• {bf.videos_per_day}/day</span>
          <span>• {maxClips} clips/video</span>
          {ytChannel && <span>→ {ytChannel.yt_channel_name}</span>}
          {bf.last_run_at && <span>• ran {timeAgo(bf.last_run_at)}</span>}
        </div>

        {isCompleted ? (
          <div className="vt" style={{ fontSize: isMobile ? 14 : 16, color: C.signalDeep }}>
            All {total} videos clipped and posted!
          </div>
        ) : (
          <ProgressBar value={processed} max={total || processed + 1} />
        )}

        {/* Collapsible settings */}
        {!isCompleted && (
          <>
            <button onClick={() => setSettingsOpen(o => !o)} className="pixel" style={{
              marginTop: 12, padding: "7px 12px", fontSize: 7, cursor: "pointer",
              background: settingsOpen ? C.lavender : C.cream2,
              color: C.ink, border: BORDER,
              boxShadow: settingsOpen ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
              transform: settingsOpen ? "translate(2px,2px)" : "none",
            }}>
              Aa CLIP SETTINGS {settingsOpen ? "▴" : "▾"}
            </button>
            {settingsOpen && (
              <ClipSettings
                vals={{ captionStyle, fontSize, highlightColor, captionLang, maxClips }}
                onChange={handleChange}
                isMobile={isMobile}
              />
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, padding: isMobile ? "10px 14px" : "10px 16px", borderTop: `2px solid ${C.ink}22`, justifyContent: "flex-end" }}>
        {!isCompleted && <PixelBtn color="amber" size="sm" onClick={() => onRunNow(bf.id)}>RUN NOW</PixelBtn>}
        <PixelBtn color="hot" size="sm" onClick={() => onRemove(bf.id)}>REMOVE</PixelBtn>
      </div>
    </PixelCard>
  );
}

export default function DigestPage() {
  const { ytStatus, isPro } = useApp();
  const isMobile = useMobile();
  const [backfills, setBackfills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [urlInput, setUrlInput]     = useState("");
  const [daysBack, setDaysBack]     = useState(30);
  const [videosPerDay, setVideosPerDay] = useState(2);
  const [ytChannelId, setYtChannelId]   = useState("");
  // clip/caption settings for new channel
  const [maxClips, setMaxClips]             = useState(3);
  const [captionStyle, setCaptionStyle]     = useState("bold_bottom");
  const [fontSize, setFontSize]             = useState(null);
  const [highlightColor, setHighlightColor] = useState(null);
  const [captionLang, setCaptionLang]       = useState("source");

  const ytChannels = ytStatus?.channels || [];

  useEffect(() => {
    if (ytChannels.length > 0 && !ytChannelId) setYtChannelId(ytChannels[0].yt_channel_id);
  }, [ytStatus]);

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
        body: JSON.stringify({
          channel_url: urlInput.trim(),
          days_back: daysBack,
          videos_per_day: videosPerDay,
          yt_upload_channel_id: ytChannelId,
          max_clips: maxClips,
          caption_style: captionStyle,
          caption_font_size: fontSize,
          caption_highlight_color: highlightColor,
          caption_language: captionLang,
        }),
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

  const handleFormChange = (key, value) => {
    const map = {
      captionStyle: setCaptionStyle, fontSize: setFontSize,
      highlightColor: setHighlightColor, captionLang: setCaptionLang, maxClips: setMaxClips,
    };
    map[key]?.(value);
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

        <div style={{ marginBottom: 20 }}>
          <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 8 }}>DIGEST</div>
          <h1 className="pixel" style={{ fontSize: isMobile ? 20 : 26, color: C.ink }}>Channel digest.</h1>
          {!isMobile && (
            <p className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 6 }}>
              Pick a channel and a time window — ClipForge clips and posts a few videos per day until the backlog is done.
            </p>
          )}
        </div>

        {/* Add form */}
        <PixelCard color={C.cream} padding={isMobile ? 14 : 22} style={{ marginBottom: 20 }}>
          <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 12 }}>ADD DIGEST CHANNEL</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: isMobile ? "10px 12px" : "12px 14px", background: C.paper, border: BORDER, boxShadow: SHADOW_SM, marginBottom: 14 }}>
            <span className="pixel" style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>{`>`}</span>
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder={isMobile ? "youtube.com/@channel" : "https://youtube.com/@channel or /channel/UCxxx"}
              className="mono"
              style={{ flex: 1, background: "transparent", color: C.ink, fontSize: isMobile ? 12 : 13, fontWeight: 500, minWidth: 0, width: "100%" }} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: isMobile ? "1 1 130px" : "0 0 auto" }}>
                <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>LOOK BACK</div>
                <select value={daysBack} onChange={e => setDaysBack(Number(e.target.value))} className="pixel"
                  style={{ width: "100%", padding: "9px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 8 }}>
                  {DAY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>

              <div style={{ flex: isMobile ? "1 1 130px" : "0 0 auto" }}>
                <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>VIDEOS / DAY</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {VPD_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => setVideosPerDay(opt.value)} className="pixel" style={{
                      flex: isMobile ? 1 : "0 0 auto", padding: "8px 10px", fontSize: 8,
                      background: videosPerDay === opt.value ? opt.color : C.cream2, color: C.ink, border: BORDER,
                      boxShadow: videosPerDay === opt.value ? "2px 2px 0 " + C.ink : SHADOW_SM,
                      transform: videosPerDay === opt.value ? "translate(2px,2px)" : "none", cursor: "pointer",
                    }}>{opt.value}</button>
                  ))}
                </div>
              </div>
            </div>

            {ytChannels.length > 0 && (
              <div>
                <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>UPLOAD TO</div>
                {ytChannels.length === 1 ? (
                  <div className="pixel" style={{ fontSize: 9, padding: "9px 12px", background: C.yt, border: BORDER, color: C.ink, display: "inline-block" }}>
                    * {ytChannels[0].yt_channel_name || "YouTube"}
                  </div>
                ) : (
                  <select value={ytChannelId} onChange={e => setYtChannelId(e.target.value)} className="pixel"
                    style={{ width: isMobile ? "100%" : "auto", padding: "9px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 8 }}>
                    {ytChannels.map(c => <option key={c.yt_channel_id} value={c.yt_channel_id}>{c.yt_channel_name || c.yt_channel_id}</option>)}
                  </select>
                )}
              </div>
            )}

            {/* Clip settings toggle */}
            <div>
              <button onClick={() => setSettingsOpen(o => !o)} className="pixel" style={{
                padding: "7px 12px", fontSize: 7, cursor: "pointer",
                background: settingsOpen ? C.lavender : C.cream2, color: C.ink, border: BORDER,
                boxShadow: settingsOpen ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
                transform: settingsOpen ? "translate(2px,2px)" : "none",
              }}>
                Aa CLIP SETTINGS {settingsOpen ? "▴" : "▾"}
              </button>
              {settingsOpen && (
                <ClipSettings
                  vals={{ captionStyle, fontSize, highlightColor, captionLang, maxClips }}
                  onChange={handleFormChange}
                  isMobile={isMobile}
                />
              )}
            </div>
          </div>

          <PixelBtn color="hot" onClick={handleAdd} disabled={adding || !urlInput.trim()}
            style={isMobile ? { width: "100%", textAlign: "center", justifyContent: "center" } : {}}>
            {adding ? "RESOLVING..." : "+ ADD CHANNEL"}
          </PixelBtn>

          {addError && (
            <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginTop: 10, padding: "8px 10px", background: `${C.hot}44`, border: `2px solid ${C.hotDeep}` }}>
              ! {addError}
            </div>
          )}
        </PixelCard>

        {loading ? (
          <PixelCard color={C.cream} padding={48} style={{ textAlign: "center" }}>
            <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Loading...</p>
          </PixelCard>
        ) : backfills.length === 0 ? (
          <PixelCard color={C.paper} padding={isMobile ? 24 : 48} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 8 }}>NO DIGEST CHANNELS</div>
            <p className="vt" style={{ fontSize: 16, color: C.dim2 }}>Add a channel above to start digesting its backlog.</p>
          </PixelCard>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {backfills.map(bf => (
              <DigestCard key={bf.id} bf={bf} ytStatus={ytStatus}
                onRemove={handleRemove} onRunNow={handleRunNow} onPatch={handlePatch} isMobile={isMobile} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
