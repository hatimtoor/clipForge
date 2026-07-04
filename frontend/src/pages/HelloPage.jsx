import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { C, BORDER, SHADOW_SM, SHADOW, KEYFRAMES } from "../lib/theme";
import { PixelBtn, PixelCard, NumField, Toggle, Tag } from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";
import { CaptionStyleGrid, CUSTOMIZABLE_CAPTION_STYLES } from "../components/CaptionPreviews";
import FacecamBoxModal, { youtubeId } from "../components/FacecamBoxModal";
import OnboardingTour from "../components/OnboardingTour";

const TOUR_STEPS = [
  { target: "#tour-url",       title: "START WITH A LINK",
    text: "Paste any YouTube URL — podcast, stream, lecture. This is where every job begins." },
  { target: "#tour-find",      title: "TELL THE AI WHAT TO CLIP",
    text: "Optional but powerful: \"every moment about pricing\", \"the funniest reactions\". EXCLUDE below keeps intros and sponsor reads out." },
  { target: "#tour-durations", title: "HOW MANY, HOW LONG",
    text: "Up to 10 clips per job. Set a length range or use the quick buckets underneath." },
  { target: "#tour-layout",    title: "PICK A LAYOUT",
    text: "FILL tracks the speaker. SPLIT stacks two people. GAMEPLAY puts the facecam on top. AUTO ✨ reads the video and decides for you." },
  { target: "#tour-format",    title: "PICK A FORMAT",
    text: "9:16 for Shorts and TikTok, 1:1 for feeds, 16:9 for YouTube. Pro unlocks all three." },
  { target: "#tour-captions",  title: "CAPTIONS, YOUR WAY",
    text: "Live previews of every style — the highlight moves exactly like the burned-in captions. AI keywords and emoji are on by default." },
  { target: "#tour-submit",    title: "ROLL TAPE!",
    text: "That's everything. Clips arrive in a few minutes — watch progress on WORK, revisit them anytime in ARCHIVE." },
];

export default function HelloPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isPro, setJobActive, refreshProfile } = useApp();

  // Returning from a Lemon Squeezy checkout: the webhook grants Pro server-side,
  // but may land a moment after the redirect — poll the profile a few times so
  // the UI flips to Pro without a manual refresh.
  useEffect(() => {
    if (searchParams.get("upgraded") !== "1") return;
    let n = 0;
    const id = setInterval(() => {
      refreshProfile?.();
      if (++n >= 5) clearInterval(id);
    }, 2000);
    window.history.replaceState({}, "", "/hello");  // drop the ?upgraded flag
    return () => clearInterval(id);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const [url, setUrl] = useState(searchParams.get("url") || "");
  const [maxClips, setMaxClips] = useState(Number(searchParams.get("max_clips")) || 5);
  const [minDur, setMinDur] = useState(Number(searchParams.get("min_dur")) || 30);
  const [maxDur, setMaxDur] = useState(Number(searchParams.get("max_dur")) || 90);
  const [reframe, setReframe] = useState(searchParams.get("reframe") === "1");
  const [clipStyle, setClipStyle] = useState(searchParams.get("clip_style") || "reframe");
  const [aspectRatio, setAspectRatio] = useState(searchParams.get("aspect_ratio") || "9:16");
  const [facecamBox, setFacecamBox] = useState(null);
  const [camModalOpen, setCamModalOpen] = useState(false);
  const [trimSilence, setTrimSilence] = useState(searchParams.get("trim_silence") === "1");
  const [stylePrompt, setStylePrompt] = useState(searchParams.get("style_prompt") || "");
  const [excludePrompt, setExcludePrompt] = useState(searchParams.get("exclude_prompt") || "");
  const [tfStart, setTfStart] = useState(Number(searchParams.get("tf_start")) || 0);
  const [tfEnd, setTfEnd] = useState(Number(searchParams.get("tf_end")) || 0);
  const [captionStyle, setCaptionStyle] = useState(searchParams.get("caption_style") || "bold_bottom");
  const [fontSizeOverride, setFontSizeOverride] = useState(searchParams.get("font_size") ? Number(searchParams.get("font_size")) : null);
  const [highlightColor, setHighlightColor] = useState(searchParams.get("highlight_color") || null);
  const [captionLanguage, setCaptionLanguage] = useState(searchParams.get("caption_language") || "source");
  const [captionPosition, setCaptionPosition] = useState(searchParams.get("caption_position") || "default");
  const [captionKeywords, setCaptionKeywords] = useState(searchParams.get("caption_keywords") !== "0");
  const [captionEmoji, setCaptionEmoji] = useState(searchParams.get("caption_emoji") !== "0");
  const [bgMusicUrl, setBgMusicUrl] = useState("");
  const [bgMusicVolume, setBgMusicVolume] = useState(0.15);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const STYLE_FONT_DEFAULTS = {
    bold_bottom: 72, center_pop: 88, minimal: 56,
    karaoke: 76, hormozi: 84, beasty: 92, bold_statement: 64, simple: 56, pod_p: 62,
  };
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

  const handleStyleChange = (id) => {
    setCaptionStyle(id);
    if (fontSizeOverride !== null) setFontSizeOverride(null);
    // Designed templates keep their identity — size/colour tweaks only apply
    // to the plain styles, so clear a stale pick when switching away.
    if (!CUSTOMIZABLE_CAPTION_STYLES.includes(id) && highlightColor) setHighlightColor(null);
  };
  const captionCustomizable = CUSTOMIZABLE_CAPTION_STYLES.includes(captionStyle);

  const valid = /youtu\.?be/.test(url);
  const isMobile = useMobile();

  const handleSubmit = async () => {
    if (!url.trim()) { setError("Paste a YouTube URL first."); return; }
    setError(""); setLoading(true);
    try {
      const res = await authFetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url, max_clips: maxClips, min_duration: minDur, max_duration: maxDur,
          reframe: clipStyle === "reframe" && reframe,
          clip_style: clipStyle,
          aspect_ratio: ["facecam", "split", "screenshare", "auto"].includes(clipStyle) ? "9:16" : aspectRatio,
          facecam_box: facecamBox || undefined,
          trim_silence: trimSilence,
          style_prompt: stylePrompt.trim() || undefined,
          exclude_prompt: excludePrompt.trim() || undefined,
          timeframe_start_min: tfStart > 0 ? tfStart : undefined,
          timeframe_end_min: tfEnd > 0 ? tfEnd : undefined,
          caption_style: captionStyle,
          caption_font_size: (captionCustomizable && fontSizeOverride) || undefined,
          caption_highlight_color: (captionCustomizable && highlightColor) || undefined,
          caption_position: captionPosition !== "default" ? captionPosition : undefined,
          caption_keywords: captionKeywords,
          caption_emoji: captionEmoji,
          caption_language: captionLanguage || "source",
          bg_music_url: bgMusicUrl.trim() || undefined,
          bg_music_volume: bgMusicVolume,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Failed to start job.");
        setLoading(false);
        return;
      }
      setJobActive(data.job_id);
      navigate(`/work?job=${data.job_id}`);
    } catch {
      setError("Failed to start job. Is the server running?");
      setLoading(false);
    }
  };

  const effectiveFontSize = fontSizeOverride ?? STYLE_FONT_DEFAULTS[captionStyle] ?? 72;

  // Locked stand-in for a Pro-only toggle — clicking sends free users to /upgrade.
  const ProToggle = ({ label, hint }) => (
    <button onClick={() => navigate("/upgrade")} className="pixel" style={{
      textAlign: "left", padding: 14, background: C.cream2, color: C.dim,
      border: BORDER, boxShadow: SHADOW_SM, cursor: "pointer", minWidth: 0,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ flexShrink: 0 }}><Tag bg={C.amber} color={C.ink}>PRO</Tag></span>
      </div>
      <div className="vt" style={{ fontSize: 14, color: C.dim2, letterSpacing: 0, textTransform: "none", lineHeight: 1.2 }}>{hint}</div>
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", overflowX: "clip" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 16px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1.55fr) minmax(0,1fr)", gap: isMobile ? 16 : 32, alignItems: "start" }}>

          {/* ── Main card ── */}
          <PixelCard color={C.cream} padding={isMobile ? 18 : 32} style={isMobile ? { boxShadow: "none" } : {}}>
            <div className="pixel" style={{ fontSize: 10, color: C.hotDeep, marginBottom: 16 }}>{`>`} NEW JOB - STANDING BY</div>
            <h1 className="pixel" style={{ fontSize: isMobile ? 20 : 30, lineHeight: 1.3, color: C.ink, marginBottom: 14 }}>
              Drop a long video.<br />
              <span style={{ color: C.signalDeep }}>Pull the moments<br />that travel.</span>
            </h1>
            <p className="vt" style={{ fontSize: isMobile ? 18 : 22, color: C.dim2, lineHeight: 1.4, marginBottom: 28 }}>
              ⚡ One YouTube link in. <strong style={{ color: C.ink }}>Up to 10 viral-ready shorts</strong> out — captions burned, hooks scored, ready to ship. ✂️
            </p>

            <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>YOUTUBE URL</div>
            <div id="tour-url" style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: C.paper, border: BORDER, boxShadow: isMobile ? "none" : (valid ? `4px 4px 0 ${C.signalDeep}` : `4px 4px 0 ${C.ink}`), marginBottom: 24, transition: "box-shadow .15s" }}>
              <span className="pixel" style={{ fontSize: 12, color: valid ? C.signalDeep : C.dim }}>{`>`}</span>
              <input value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && valid && handleSubmit()}
                placeholder="https://youtube.com/watch?v="
                className="mono" style={{ flex: 1, background: "transparent", color: C.ink, fontSize: 15, fontWeight: 500, minWidth: 0 }} />
              {url && <button onClick={() => setUrl("")} className="pixel" style={{ background: "transparent", color: C.dim, fontSize: 9, cursor: "pointer" }}>x</button>}
              {valid && <Tag color={C.signalDeep} bg={C.signal}>v OK</Tag>}
            </div>

            <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>FIND <span style={{ color: C.dim, fontWeight: 400 }}>(optional — what should the AI clip?)</span></div>
            <div id="tour-find" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: C.paper, border: BORDER, marginBottom: 12 }}>
              <input
                value={stylePrompt}
                onChange={e => setStylePrompt(e.target.value)}
                placeholder="e.g. every moment about pricing, the funniest reactions"
                className="mono"
                style={{ flex: 1, background: "transparent", color: C.ink, fontSize: 14, minWidth: 0 }}
              />
              {stylePrompt && <button onClick={() => setStylePrompt("")} className="pixel" style={{ background: "transparent", color: C.dim, fontSize: 9, cursor: "pointer" }}>x</button>}
            </div>

            <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>EXCLUDE <span style={{ color: C.dim, fontWeight: 400 }}>(optional — topics to never clip)</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: C.paper, border: BORDER, marginBottom: 24 }}>
              <input
                value={excludePrompt}
                onChange={e => setExcludePrompt(e.target.value)}
                placeholder="e.g. intros, sponsor reads, audio checks"
                className="mono"
                style={{ flex: 1, background: "transparent", color: C.ink, fontSize: 14, minWidth: 0 }}
              />
              {excludePrompt && <button onClick={() => setExcludePrompt("")} className="pixel" style={{ background: "transparent", color: C.dim, fontSize: 9, cursor: "pointer" }}>x</button>}
            </div>

            <div id="tour-durations" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: isMobile ? 8 : 14, marginBottom: 12 }}>
              <NumField label="MAX CLIPS" value={maxClips} setValue={setMaxClips} min={1} max={10} step={1} bg={C.lavender} />
              <NumField label="MIN DUR" suffix="s" value={minDur} setValue={setMinDur} min={15} max={90} step={5} bg={C.peach} />
              <NumField label="MAX DUR" suffix="s" value={maxDur} setValue={setMaxDur} min={30} max={180} step={10} bg={C.amber} />
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {[
                { label: "< 30S", min: 15, max: 30 },
                { label: "30-60S", min: 30, max: 60 },
                { label: "60-90S", min: 60, max: 90 },
                { label: "90S+", min: 90, max: 180 },
              ].map(({ label, min, max }) => {
                const active = minDur === min && maxDur === max;
                return (
                  <button key={label} onClick={() => { setMinDur(min); setMaxDur(max); }} className="pixel"
                    style={{ padding: "6px 12px", fontSize: 8, cursor: "pointer",
                      background: active ? C.signal : C.cream2, color: C.ink,
                      border: active ? `2px solid ${C.ink}` : `2px solid ${C.ink}33`,
                      boxShadow: active ? `2px 2px 0 ${C.ink}` : "none", transition: "all .1s" }}>
                    {label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isMobile ? 8 : 14, marginBottom: 24 }}>
              <NumField label="CLIP FROM" suffix="min" value={tfStart} setValue={setTfStart} min={0} max={600} step={1} bg={C.cream2} />
              <NumField label="CLIP UNTIL" suffix="min" value={tfEnd} setValue={setTfEnd} min={0} max={600} step={1} bg={C.cream2} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: isMobile ? 8 : 10, marginBottom: 28 }}>
              <Toggle on={true} setOn={() => {}} label="HOOKS" hint="find the line that travels" />
              <Toggle on={true} setOn={() => {}} label="CAPS" hint="burn word-by-word subs" />
              {isPro
                ? <Toggle on={reframe && clipStyle === "reframe"} setOn={v => { setReframe(v); if (v) setClipStyle("reframe"); }} label={isMobile ? "RF" : "REFRAME"} hint="YOLO speaker tracking → 9:16 portrait" />
                : <ProToggle label={isMobile ? "RF" : "REFRAME"} hint="upgrade to unlock reframe" />
              }
              {isPro
                ? <Toggle on={trimSilence} setOn={setTrimSilence} label="TRIM" hint="cut out pauses & dead air" />
                : <ProToggle label="TRIM" hint="upgrade to cut pauses & dead air" />
              }
            </div>

            <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>LAYOUT {!isPro && <Tag bg={C.amber} color={C.ink}>PRO</Tag>}</div>
            <div id="tour-layout" style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
              {[
                { id: "auto",    label: "AUTO ✨",  hint: "AI picks the best layout per video", pro: true },
                { id: "reframe", label: "FILL",     hint: "9:16 crop (tracked with REFRAME)", pro: false },
                { id: "fit",     label: "FIT",      hint: "whole frame, letterboxed",          pro: true },
                { id: "blur_bg", label: "BLUR BG",  hint: "centered on blurred fill",          pro: true },
                { id: "split",      label: "SPLIT",    hint: "2 speakers stacked 50/50",       pro: true },
                { id: "screenshare", label: "SCREEN",  hint: "screen top, speaker bottom",     pro: true },
                { id: "facecam",    label: "GAMEPLAY", hint: "cam top 30%, gameplay 70%",      pro: true },
              ].map(({ id, label, hint, pro }) => {
                const active = clipStyle === id;
                const locked = pro && !isPro;
                return (
                  <button key={id} title={hint}
                    onClick={() => { if (locked) { navigate("/upgrade"); return; } setClipStyle(id); if (id !== "reframe") setReframe(false); }}
                    className="pixel"
                    style={{ flex: "1 1 auto", padding: "9px 10px", fontSize: 8, cursor: "pointer",
                      background: active ? C.signal : C.cream2, color: locked ? C.dim : C.ink,
                      border: active ? `2px solid ${C.ink}` : `2px solid ${C.ink}33`,
                      boxShadow: active ? `2px 2px 0 ${C.ink}` : "none", transition: "all .1s" }}>
                    {label}{locked ? " 🔒" : ""}
                  </button>
                );
              })}
            </div>

            {["facecam", "screenshare", "auto"].includes(clipStyle) && (
              <div style={{ marginBottom: 16 }}>
                <button onClick={() => setCamModalOpen(true)} className="pixel" id="tour-cambox"
                  style={{ width: "100%", textAlign: "left", padding: "10px 12px", fontSize: 8, cursor: "pointer",
                    background: facecamBox ? C.signal : C.cream2, color: C.ink,
                    border: facecamBox ? `2px solid ${C.ink}` : `2px solid ${C.ink}33`,
                    boxShadow: facecamBox ? `2px 2px 0 ${C.ink}` : "none", transition: "all .1s" }}>
                  {facecamBox ? "✓ CAM BOX SET — click to adjust" : "▦ MARK THE FACECAM (optional — auto-detect otherwise)"}
                </button>
              </div>
            )}

            <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>FORMAT</div>
            <div id="tour-format" style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              {[
                { id: "9:16", label: "9:16 SHORTS" },
                { id: "1:1", label: "1:1 SQUARE" },
                { id: "16:9", label: "16:9 WIDE" },
              ].map(({ id, label }) => {
                const active = aspectRatio === id;
                const locked = id !== "9:16" && !isPro;
                const unavailable = ["facecam", "split", "screenshare", "auto"].includes(clipStyle) && id !== "9:16";
                return (
                  <button key={id} disabled={unavailable}
                    onClick={() => { if (locked) { navigate("/upgrade"); return; } setAspectRatio(id); }}
                    className="pixel"
                    style={{ flex: 1, padding: "9px 0", fontSize: 8,
                      cursor: unavailable ? "not-allowed" : "pointer",
                      opacity: unavailable ? 0.4 : 1,
                      background: active ? C.signal : C.cream2, color: locked ? C.dim : C.ink,
                      border: active ? `2px solid ${C.ink}` : `2px solid ${C.ink}33`,
                      boxShadow: active ? `2px 2px 0 ${C.ink}` : "none", transition: "all .1s" }}>
                    {label}{locked ? " 🔒" : ""}
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="pixel" style={{ padding: "10px 12px", background: `${C.hot}55`, border: `2px solid ${C.hotDeep}`, color: C.hotDeep, fontSize: 9, marginBottom: 16 }}>
                ! {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: isMobile ? "center" : "space-between", alignItems: "center", paddingTop: 18, borderTop: `2px dashed ${C.ink}33`, gap: 14, flexWrap: "wrap" }}>
              {!isMobile && <div className="vt" style={{ fontSize: 18, color: C.dim2 }}>Ctrl+V to paste · Enter to forge · est. 2-4 min</div>}
              <PixelBtn id="tour-submit" color="hot" size="lg" onClick={handleSubmit} disabled={!valid || loading} style={isMobile ? { width: "100%" } : {}}>
                {loading ? "STARTING..." : `> ROLL TAPE`}
              </PixelBtn>
            </div>
          </PixelCard>

          {/* ── Right column ── */}
          <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            <PixelCard color={C.paper} padding={22} style={{ order: isMobile ? 1 : 0, ...(isMobile ? { boxShadow: "none" } : {}) }}>
              <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 14 }}>WHAT WE LOOK FOR</div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  ["⚡", "Tension shifts", "Moments where energy changes register."],
                  ["💰", "Numbers & names", "Specific dollar figures, ages, places."],
                  ["🌶️", "Contrarian frames", "Statements that invite disagreement."],
                  ["💬", "Confessions", "First-person admissions land everywhere."],
                ].map(([emoji, h, d]) => (
                  <li key={h} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 12, alignItems: "start" }}>
                    <div style={{ fontSize: 20 }}>{emoji}</div>
                    <div>
                      <div className="pixel" style={{ fontSize: 10, color: C.ink }}>{h}</div>
                      <div className="vt" style={{ fontSize: 18, color: C.dim2, lineHeight: 1.3, marginTop: 3 }}>{d}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </PixelCard>

            {/* Caption customisation card */}
            <PixelCard color={C.cream} padding={isMobile ? 16 : 20} style={{ order: isMobile ? 0 : 1, ...(isMobile ? { boxShadow: "none" } : {}) }}>
              <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 14 }}>CAPTION STYLE</div>

              <div id="tour-captions" style={{ marginBottom: 20 }}>
                <CaptionStyleGrid value={captionStyle} onChange={handleStyleChange}
                  highlightColor={highlightColor} isMobile={isMobile} />
              </div>

              <div style={{ marginBottom: 20 }}>
                <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>CAPTION POSITION</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[
                    { id: "default", label: "AUTO" },
                    { id: "bottom",  label: "BOTTOM" },
                    { id: "middle",  label: "MID" },
                    { id: "top",     label: "TOP" },
                  ].map(({ id, label }) => (
                    <button key={id} onClick={() => setCaptionPosition(id)} className="pixel"
                      style={{ flex: 1, padding: "9px 0", fontSize: 8, cursor: "pointer",
                        background: captionPosition === id ? C.signal : C.cream2, color: C.ink,
                        border: captionPosition === id ? `2px solid ${C.ink}` : `2px solid ${C.ink}33`,
                        boxShadow: captionPosition === id ? `2px 2px 0 ${C.ink}` : "none",
                        transition: "all .1s" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
                {[
                  { on: captionKeywords, toggle: () => setCaptionKeywords(k => !k),
                    label: "AI KEYWORDS", hint: "color the words that carry the clip" },
                  { on: captionEmoji, toggle: () => setCaptionEmoji(k => !k),
                    label: "AI EMOJI", hint: "drop a fitting emoji on big moments" },
                ].map(({ on, toggle, label, hint }) => (
                  <button key={label} onClick={toggle} className="pixel"
                    style={{ textAlign: "left", padding: 12, cursor: "pointer",
                      background: on ? C.signal : C.cream2,
                      border: on ? `3px solid ${C.ink}` : BORDER,
                      boxShadow: on ? SHADOW : SHADOW_SM, transition: "all .12s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 9, color: C.ink }}>{label}</span>
                      <span style={{ fontSize: 9, color: C.dim2 }}>{on ? "ON" : "OFF"}</span>
                    </div>
                    <div className="vt" style={{ fontSize: 12, color: C.dim2, letterSpacing: 0, textTransform: "none", lineHeight: 1.2, marginTop: 3 }}>
                      {hint}
                    </div>
                  </button>
                ))}
              </div>

              <div style={{ marginBottom: 20 }}>
                <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>CAPTION LANGUAGE</div>
                <select value={captionLanguage} onChange={e => setCaptionLanguage(e.target.value)}
                  className="mono"
                  style={{ width: "100%", padding: "10px 12px", background: C.paper, color: C.ink,
                    border: BORDER, fontSize: 13, cursor: "pointer", appearance: "none",
                    WebkitAppearance: "none", outline: "none" }}>
                  {CAPTION_LANGUAGES.map(({ code, label }) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>

              {captionCustomizable && (
                <>
                  <div style={{ borderTop: `2px solid ${C.ink}11`, paddingTop: 16, marginBottom: 16 }}>
                    <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 10 }}>FONT SIZE</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <NumField
                          label=""
                          value={effectiveFontSize}
                          setValue={setFontSizeOverride}
                          min={40} max={120} step={4}
                          bg={C.paper}
                        />
                      </div>
                      <button onClick={() => setFontSizeOverride(null)} className="pixel"
                        style={{ flex: 1, padding: "10px 0", fontSize: 9, cursor: "pointer",
                          background: fontSizeOverride === null ? C.signal : C.cream2,
                          color: C.ink,
                          border: BORDER,
                          boxShadow: fontSizeOverride === null ? `2px 2px 0 ${C.ink}` : SHADOW_SM }}>
                        AUTO
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 10 }}>HIGHLIGHT COLOR</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {HIGHLIGHT_SWATCHES.map(({ color, label, bg, fg }) => {
                        const active = highlightColor === color;
                        return (
                          <button key={label} onClick={() => setHighlightColor(color)} className="pixel"
                            style={{ padding: "7px 11px", fontSize: 8, background: bg, color: fg,
                              border: active ? `2px solid ${C.ink}` : `2px solid ${C.ink}33`,
                              boxShadow: active ? `2px 2px 0 ${C.ink}` : "none",
                              cursor: "pointer", transition: "all .1s" }}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              <div style={{ borderTop: `2px solid ${C.ink}11`, paddingTop: 16, marginTop: 16 }}>
                <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontFamily: "sans-serif" }}>🎵</span> BACKGROUND MUSIC <span style={{ color: C.dim }}>(optional)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: C.paper, border: BORDER, marginBottom: 10 }}>
                  <span className="pixel" style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>{`>`}</span>
                  <input value={bgMusicUrl} onChange={e => setBgMusicUrl(e.target.value)}
                    placeholder="paste a YouTube music URL"
                    className="mono" style={{ flex: 1, background: "transparent", color: C.ink, fontSize: 12, fontWeight: 500, minWidth: 0, outline: "none", border: "none" }} />
                </div>
                {bgMusicUrl.trim() && (
                  <div>
                    <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>MUSIC VOLUME</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[["Quiet", 0.08], ["Soft", 0.15], ["Medium", 0.30], ["Loud", 0.50]].map(([label, vol]) => (
                        <button key={label} onClick={() => setBgMusicVolume(vol)} className="pixel" style={{
                          flex: 1, padding: "8px 4px", fontSize: 8, cursor: "pointer",
                          background: bgMusicVolume === vol ? C.signal : C.cream2, color: C.ink, border: BORDER,
                          boxShadow: bgMusicVolume === vol ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
                          transform: bgMusicVolume === vol ? "translate(2px,2px)" : "none",
                        }}>{label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </PixelCard>

            <PixelCard color={C.lavender} padding={20} style={{ order: 2, ...(isMobile ? { boxShadow: "none" } : {}) }}>
              <div className="pixel" style={{ fontSize: 10, color: C.ink, marginBottom: 10 }}><span style={{ fontSize: 20 }}>💁‍♂️</span> TIP</div>
              <p className="vt" style={{ fontSize: 18, color: C.ink, lineHeight: 1.35 }}>
                Long videos can take 5-10 min. Your job keeps running on the server even if you close this tab — find it under <strong>ARCHIVE</strong>.
              </p>
            </PixelCard>
          </aside>

        </div>
      </div>
      <OnboardingTour steps={TOUR_STEPS} />
      {camModalOpen && (
        <FacecamBoxModal
          videoId={youtubeId(url)}
          value={facecamBox ? { x: facecamBox[0], y: facecamBox[1], w: facecamBox[2], h: facecamBox[3] } : null}
          onSave={setFacecamBox}
          onClose={() => setCamModalOpen(false)}
        />
      )}
    </div>
  );
}
