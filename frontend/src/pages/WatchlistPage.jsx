import { useState, useEffect } from "react";
import { C, BORDER, BORDER_SM, SHADOW, SHADOW_SM, KEYFRAMES } from "../lib/theme";
import { PixelBtn, PixelCard, Tag } from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

const CAPTION_STYLES = [
  { id: "bold_bottom", label: "BOLD",    hint: "white + yellow, bottom", bg: C.amber    },
  { id: "center_pop",  label: "POP",     hint: "large, centered",         bg: C.lavender },
  { id: "minimal",     label: "MINIMAL", hint: "small, clean",            bg: C.signal   },
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
  { code: "source", label: "Source (no translation)" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ru", label: "Russian" },
  { code: "nl", label: "Dutch" },
  { code: "tr", label: "Turkish" },
];

function UpgradeGate() {
  const isMobile = useMobile();
  return (
    <div className="fade" style={{ padding: isMobile ? "24px 16px 48px" : "64px 32px", maxWidth: 760, margin: "0 auto" }}>
      <PixelCard color={C.amber} padding={isMobile ? 24 : 40} style={{ textAlign: "center" }}>
        <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 12 }}>PRO FEATURE</div>
        <h2 className="pixel" style={{ fontSize: isMobile ? 16 : 22, color: C.ink, lineHeight: 1.4, marginBottom: 14 }}>Channel Watchlist</h2>
        <p className="vt" style={{ fontSize: isMobile ? 18 : 20, color: C.ink, lineHeight: 1.5, marginBottom: 24, maxWidth: 520, margin: "0 auto 24px" }}>
          Monitor YouTube channels and auto-clip new videos the moment they drop.
        </p>
        <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginTop: 8 }}>
          Upgrade to Pro to unlock this feature.
        </div>
      </PixelCard>
    </div>
  );
}

function ChannelCard({ ch, onRemove, onToggleAutoUpload, onCheckNow, checking, onSetUploadChannel, onSetTtAccount }) {
  const [maxClips, setMaxClips] = useState(ch.max_clips ?? 3);
  const [minDur,   setMinDur]   = useState(ch.min_duration ?? 30);
  const [maxDur,   setMaxDur]   = useState(ch.max_duration ?? 90);
  const [captionOpen,    setCaptionOpen]    = useState(false);
  const [captionStyle,   setCaptionStyle]   = useState(ch.caption_style ?? "bold_bottom");
  const [fontSize,       setFontSize]       = useState(ch.caption_font_size ?? null);
  const [highlightColor, setHighlightColor] = useState(ch.caption_highlight_color ?? null);
  const [captionLang,    setCaptionLang]    = useState(ch.caption_language ?? "source");
  const [bgMusicUrl,     setBgMusicUrl]     = useState(ch.bg_music_url ?? "");
  const [bgMusicVolume,  setBgMusicVolume]  = useState(ch.bg_music_volume ?? 0.15);
  const [trimSilence,    setTrimSilence]    = useState(ch.trim_silence ?? false);
  const { ytStatus, ttStatus } = useApp();
  const [selectedYtChannel, setSelectedYtChannel] = useState(ch.yt_channel_id ?? "");
  const [selectedTtAccount, setSelectedTtAccount] = useState(ch.tt_open_id ?? "");
  const isMobile = useMobile();

  const effectiveFontSize = fontSize ?? CAPTION_FONT_DEFAULTS[captionStyle] ?? 72;

  const patch = async (fields) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  };

  const adj = (val, setVal, min, max, delta, field) => {
    const next = Math.min(max, Math.max(min, val + delta));
    setVal(next);
    patch({ [field]: next });
  };

  const statusColor = (s) => s === "error" ? C.hot : s === "watching" ? C.signal : C.amber;
  const timeAgoShort = (iso) => {
    if (!iso) return "never";
    const d = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (d < 60) return `${d}s ago`;
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86400)}d ago`;
  };

  const Stepper = ({ label, val, setVal, min, max, step, field, suffix = "" }) => (
    <div>
      <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", border: BORDER_SM, boxShadow: `2px 2px 0 ${C.ink}`, background: C.paper }}>
        <button onClick={() => adj(val, setVal, min, max, -step, field)} className="pixel"
          style={{ width: 26, padding: "6px 0", background: "transparent", borderRight: `2px solid ${C.ink}`, fontSize: 12, cursor: val > min ? "pointer" : "not-allowed", color: val > min ? C.ink : C.dim }}>-</button>
        <div className="pixel" style={{ flex: 1, textAlign: "center", padding: "6px 4px", fontSize: 10, color: C.ink, minWidth: 36 }}>{val}{suffix}</div>
        <button onClick={() => adj(val, setVal, min, max, +step, field)} className="pixel"
          style={{ width: 26, padding: "6px 0", background: "transparent", borderLeft: `2px solid ${C.ink}`, fontSize: 12, cursor: val < max ? "pointer" : "not-allowed", color: val < max ? C.ink : C.dim }}>+</button>
      </div>
    </div>
  );

  return (
    <PixelCard color={C.cream} padding={0} style={isMobile ? { boxShadow: "none" } : {}}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) auto", alignItems: "stretch" }}>
        <div style={{ padding: isMobile ? "16px" : "20px 22px", borderRight: isMobile ? "none" : BORDER, borderBottom: isMobile ? BORDER : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap", minWidth: 0 }}>
            <span className="pixel" style={{ fontSize: 12, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: isMobile ? "60vw" : "none" }}>{ch.name}</span>
            <Tag bg={statusColor(ch.status || "watching")} color={C.ink}>{(ch.status || "WATCHING").toUpperCase()}</Tag>
          </div>
          <div className="mono" style={{ fontSize: 12, color: C.dim2, marginBottom: 10, wordBreak: "break-all" }}>{ch.url}</div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <span className="pixel" style={{ fontSize: 7, color: C.dim2 }}>LAST CHECKED </span>
              <span className="vt" style={{ fontSize: 16, color: C.ink }}>{timeAgoShort(ch.last_checked)}</span>
            </div>
            {ch.last_video_title && (
              <div style={{ minWidth: 0 }}>
                <span className="pixel" style={{ fontSize: 7, color: C.dim2 }}>LAST VIDEO </span>
                <span className="vt" style={{ fontSize: 16, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block", maxWidth: isMobile ? "100%" : 340 }}>{ch.last_video_title}</span>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: isMobile ? 8 : 10 }}>
            <Stepper label="MAX CLIPS" val={maxClips} setVal={setMaxClips} min={1} max={10} step={1} field="max_clips" />
            <Stepper label="MIN DUR"   val={minDur}   setVal={setMinDur}   min={15} max={120} step={5}  field="min_duration" suffix="s" />
            <Stepper label="MAX DUR"   val={maxDur}   setVal={setMaxDur}   min={30} max={180} step={10} field="max_duration" suffix="s" />
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
                  className="mono" style={{ width: "100%", padding: "8px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 12, cursor: "pointer", appearance: "none", WebkitAppearance: "none", outline: "none" }}>
                  {CAPTION_LANGUAGES.map(({ code, label }) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>FONT SIZE</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                    <div style={{ flex: 1 }}>
                      <Stepper label="" val={effectiveFontSize} setVal={setFontSize} min={40} max={120} step={4} field="caption_font_size" />
                    </div>
                    <button onClick={() => { setFontSize(null); patch({ caption_font_size: null }); }} className="pixel"
                      style={{ padding: "6px 10px", fontSize: 8, cursor: "pointer",
                        background: fontSize === null ? C.signal : C.cream2,
                        color: C.ink, border: BORDER,
                        boxShadow: fontSize === null ? `2px 2px 0 ${C.ink}` : SHADOW_SM }}>
                      AUTO
                    </button>
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
                          cursor: "pointer", transition: "all .1s" }}>
                        {label}
                      </button>
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

              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `2px dashed ${C.ink}22` }}>
                <button onClick={() => { const v = !trimSilence; setTrimSilence(v); patch({ trim_silence: v }); }} className="pixel" style={{
                  width: "100%", padding: "9px 12px", fontSize: 8, cursor: "pointer", textAlign: "center",
                  background: trimSilence ? C.signal : C.cream2, color: C.ink, border: BORDER,
                  boxShadow: trimSilence ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
                  transform: trimSilence ? "translate(2px,2px)" : "none",
                }}>
                  ✂ TRIM SILENCE {trimSilence ? "ON" : "OFF"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: isMobile ? "12px 16px" : "20px 18px", display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", minWidth: isMobile ? "auto" : 170 }}>
          <PixelBtn color={ch.auto_upload ? "signal" : "cream"} size="sm" full onClick={() => onToggleAutoUpload(ch)}>
            <span style={{ fontSize: 14, fontFamily: "sans-serif" }}>🎉</span>
            {ch.auto_upload ? "AUTO-UPLOAD ON" : "AUTO-UPLOAD OFF"}
          </PixelBtn>
          {ch.auto_upload && ytStatus?.connected && (ytStatus.channels || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="pixel" style={{ fontSize: 7, color: C.ytDeep, marginBottom: 6 }}>▶ YOUTUBE</div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={selectedYtChannel} onChange={e => setSelectedYtChannel(e.target.value)} className="mono" style={{ flex: 1, padding: "8px 10px", background: C.paper, color: C.ink, border: BORDER }}>
                  {ytStatus.channels.map(c => (
                    <option key={c.yt_channel_id} value={c.yt_channel_id}>{c.yt_channel_name || c.yt_channel_id}</option>
                  ))}
                </select>
                <PixelBtn color="yt" size="sm" onClick={() => onSetUploadChannel(ch, selectedYtChannel)}>SAVE</PixelBtn>
              </div>
            </div>
          )}
          {ch.auto_upload && ttStatus?.connected && (ttStatus.accounts || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="pixel" style={{ fontSize: 7, color: C.ink, marginBottom: 6 }}>♪ TIKTOK</div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={selectedTtAccount} onChange={e => setSelectedTtAccount(e.target.value)} className="mono" style={{ flex: 1, padding: "8px 10px", background: C.paper, color: C.ink, border: BORDER }}>
                  <option value="">— off —</option>
                  {ttStatus.accounts.map(a => (
                    <option key={a.tt_open_id} value={a.tt_open_id}>{a.tt_display_name || a.tt_open_id}</option>
                  ))}
                </select>
                <PixelBtn color="cream" size="sm" onClick={() => onSetTtAccount(ch, selectedTtAccount)} style={{ background: C.ink, color: C.cream }}>SAVE</PixelBtn>
              </div>
            </div>
          )}
          <PixelBtn color="amber" size="sm" onClick={() => onCheckNow(ch.channel_id)} disabled={checking}>
            {checking ? "CHECKING..." : "CHECK NOW"}
          </PixelBtn>
          <PixelBtn color="danger" size="sm" onClick={() => onRemove(ch.channel_id)}>REMOVE</PixelBtn>
        </div>
      </div>
    </PixelCard>
  );
}

function WatchlistContent() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [checkingId, setCheckingId] = useState(null);
  const isMobile = useMobile();
  const { ytStatus } = useApp();

  const fetchChannels = async () => {
    try {
      const res = await authFetch("/api/channels");
      const data = await res.json();
      setChannels(data);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
    const i = setInterval(fetchChannels, 15000);
    return () => clearInterval(i);
  }, []);

  const handleAdd = async () => {
    if (!urlInput.trim()) return;
    setAdding(true); setAddError("");
    try {
      const res = await authFetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim(), auto_upload: false, max_clips: 3, min_duration: 30, max_duration: 90 }),
      });
      if (!res.ok) {
        const d = await res.json();
        setAddError(d.detail || "Failed to add channel");
      } else {
        setUrlInput("");
        fetchChannels();
      }
    } catch { setAddError("Cannot reach server."); }
    setAdding(false);
  };

  const handleRemove = async (id) => {
    await authFetch(`/api/channels/${id}`, { method: "DELETE" });
    fetchChannels();
  };

  const handleToggleAutoUpload = async (ch) => {
    const turningOn = !ch.auto_upload;
    const ytChannels = ytStatus?.channels || [];
    const patch = { auto_upload: turningOn };
    // Auto-select the only connected channel so user doesn't need a separate save step
    if (turningOn && ytChannels.length === 1) {
      patch.yt_channel_id = ytChannels[0].yt_channel_id;
    }
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    fetchChannels();
  };

  const handleSetUploadChannel = async (ch, yt_channel_id) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yt_channel_id }),
    });
    fetchChannels();
  };

  const handleSetTtAccount = async (ch, tt_open_id) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tt_open_id: tt_open_id || null }),
    });
    fetchChannels();
  };

  const handleCheckNow = async (id) => {
    setCheckingId(id);
    await authFetch(`/api/channels/${id}/check`, { method: "POST" });
    await fetchChannels();
    setCheckingId(null);
  };

  return (
    <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }}>WATCHLIST</div>
        <h1 className="pixel" style={{ fontSize: isMobile ? 18 : 26, color: C.ink }}>Channel monitor.</h1>
        <p className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 6 }}>
          Add channels — ClipForge checks every 30 min and clips new videos automatically.
        </p>
      </div>

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

      {loading ? (
        <PixelCard color={C.paper} padding={48} style={{ textAlign: "center", boxShadow: isMobile ? "none" : undefined }}>
          <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Loading...</p>
        </PixelCard>
      ) : channels.length === 0 ? (
        <PixelCard color={C.paper} padding={48} style={{ textAlign: "center", boxShadow: isMobile ? "none" : undefined }}>
          <div className="pixel" style={{ fontSize: 11, color: C.dim2, marginBottom: 10 }}>NO CHANNELS</div>
          <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Add a YouTube channel URL above to start monitoring.</p>
        </PixelCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {channels.map(ch => (
            <ChannelCard key={ch.channel_id} ch={ch}
              onRemove={handleRemove}
              onToggleAutoUpload={handleToggleAutoUpload}
              onCheckNow={handleCheckNow}
              checking={checkingId === ch.channel_id}
              onSetUploadChannel={handleSetUploadChannel}
              onSetTtAccount={handleSetTtAccount}
            />
          ))}
        </div>
      )}

      <PixelCard color={C.lavender} padding={18} style={{ marginTop: 24, boxShadow: isMobile ? "none" : undefined }}>
        <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 8 }}>HOW IT WORKS</div>
        <div className="vt" style={{ fontSize: 17, color: C.ink, lineHeight: 1.5 }}>
          Every 30 minutes ClipForge checks each channel for new videos.<br />
          <strong>AUTO-UPLOAD ON</strong> clips + uploads to YouTube automatically.<br />
          <strong>AUTO-UPLOAD OFF</strong> clips only, find them in ARCHIVE to review first.
        </div>
      </PixelCard>
    </div>
  );
}

export default function WatchlistPage() {
  const { isPro } = useApp();
  return (
    <div style={{ minHeight: "100vh", overflowX: "clip" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      {isPro ? <WatchlistContent /> : <UpgradeGate />}
    </div>
  );
}
