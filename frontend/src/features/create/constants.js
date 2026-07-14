/* Shared option catalogs for the create-clip flow. Values (ids, param names,
   ranges) are the backend contract — do not rename. */

export const LAYOUTS = [
  { id: "auto", label: "Auto ✨", hint: "AI picks the best layout per clip", pro: true },
  { id: "reframe", label: "Fill", hint: "9:16 crop (tracked with Reframe)", pro: false },
  { id: "dynamic", label: "Dynamic 🎙", hint: "Cuts between whoever is speaking", pro: true },
  { id: "fit", label: "Fit", hint: "Whole frame, letterboxed", pro: true },
  { id: "blur_bg", label: "Blur BG", hint: "Centered on blurred fill", pro: true },
  { id: "split", label: "Split", hint: "2 speakers stacked 50/50", pro: true },
  { id: "screenshare", label: "Screen", hint: "Screen top, speaker bottom", pro: true },
  { id: "facecam", label: "Gameplay", hint: "Cam top 30%, gameplay 70%", pro: true },
];

/* Layouts that force 9:16 output (backend renders these vertical-only). */
export const VERTICAL_ONLY_LAYOUTS = ["facecam", "split", "screenshare", "dynamic", "auto"];

/* Layouts where marking the facecam helps (otherwise auto-detected). */
export const CAM_BOX_LAYOUTS = ["facecam", "screenshare", "auto"];

export const FORMATS = [
  { id: "9:16", label: "9:16 Shorts" },
  { id: "1:1", label: "1:1 Square" },
  { id: "16:9", label: "16:9 Wide" },
];

export const DURATION_BUCKETS = [
  { label: "< 30s", min: 15, max: 30 },
  { label: "30–60s", min: 30, max: 60 },
  { label: "60–90s", min: 60, max: 90 },
  { label: "90s+", min: 90, max: 180 },
];

export const CAPTION_LANGUAGES = [
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

export const CAPTION_POSITIONS = [
  { id: "default", label: "Auto" },
  { id: "bottom", label: "Bottom" },
  { id: "middle", label: "Mid" },
  { id: "top", label: "Top" },
];

export const STYLE_FONT_DEFAULTS = {
  bold_bottom: 72,
  center_pop: 88,
  minimal: 56,
  karaoke: 76,
  hormozi: 84,
  beasty: 92,
  bold_statement: 64,
  simple: 56,
  pod_p: 62,
};

export const HIGHLIGHT_SWATCHES = [
  { color: null, label: "Auto", bg: "var(--surface-2)", fg: "var(--text-2)" },
  { color: "#FFD400", label: "Ylw", bg: "#FFD400", fg: "#222" },
  { color: "#00FFFF", label: "Cyn", bg: "#00FFFF", fg: "#222" },
  { color: "#FF4500", label: "Org", bg: "#FF4500", fg: "#fff" },
  { color: "#FF69B4", label: "Pnk", bg: "#FF69B4", fg: "#222" },
  { color: "#00FF88", label: "Grn", bg: "#00FF88", fg: "#222" },
  { color: "#FFFFFF", label: "Wht", bg: "#FFFFFF", fg: "#555" },
];

export const MUSIC_VOLUMES = [
  { id: 0.08, label: "Quiet" },
  { id: 0.15, label: "Soft" },
  { id: 0.3, label: "Medium" },
  { id: 0.5, label: "Loud" },
];

export const PRESETS = [
  { id: "default", label: "Default", apply: { maxClips: 5, minDur: 30, maxDur: 90, exactOn: false } },
  { id: "blitz", label: "Shorts blitz", apply: { maxClips: 10, minDur: 15, maxDur: 30, exactOn: false } },
  { id: "podcast", label: "Podcast", apply: { maxClips: 5, minDur: 60, maxDur: 90, exactOn: false } },
  { id: "exact", label: "I know the moment", apply: { exactOn: true } },
];

export const layoutLabel = (id) => LAYOUTS.find((l) => l.id === id)?.label || id;

/* Color-grade "filters" baked into the render. ids must match the backend
   FILTER_GRADES whitelist; preview thumbnails live in /public/filters/<id>.jpg. */
export const FILTERS = [
  { id: "none", label: "None", desc: "No grade — as recorded" },
  { id: "cinematic", label: "Cinematic", desc: "Filmic warmth + vignette" },
  { id: "punchy", label: "Punchy", desc: "Bold, saturated pop" },
  { id: "golden", label: "Golden Hour", desc: "Warm & sunlit" },
  { id: "tealorange", label: "Teal & Orange", desc: "Blockbuster grade" },
  { id: "clean", label: "Clean", desc: "Natural & crisp" },
  { id: "mono", label: "Mono", desc: "High-contrast B&W" },
];

export const filterLabel = (id) => FILTERS.find((x) => x.id === id)?.label || "None";
