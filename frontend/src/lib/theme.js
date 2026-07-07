export const C = {
  ink: "#1a0d2e",
  cream: "#f4ecd6",
  cream2: "#ebe1c4",
  paper: "#fef7e4",
  signal: "#7ddca0",
  signalDeep: "#3aa86a",
  hot: "#f5a3c7",
  hotDeep: "#d4669a",
  amber: "#f5d76e",
  amberDeep: "#d4ad3a",
  lavender: "#c8b3ec",
  lavenderDeep: "#9b7ed4",
  peach: "#ffc4a3",
  yt: "#ff7a7a",
  ytDeep: "#d44a4a",
  tt: "#7ec8e3",
  ttDeep: "#3a9ac4",
  dim: "#6b5b8a",
  dim2: "#4a3d68",
  windowBg: "#2a1d4a",
};

export const SHADOW    = `5px 5px 0 ${C.ink}`;
export const SHADOW_SM = `3px 3px 0 ${C.ink}`;
export const BORDER    = `3px solid ${C.ink}`;
export const BORDER_SM = `2px solid ${C.ink}`;

/* KEYFRAMES is now injected ONCE per legacy page by <LegacyPage> (App.jsx wraps
   not-yet-redesigned routes with it). Global rules (box-sizing, body reset,
   input reset, iOS input size) moved to src/styles/base.css; the sky/clouds/
   scanlines are scoped to .legacy-retro so legacy pages keep their exact look
   without repainting <body> and fighting the v2 theme system. */
export const KEYFRAMES = `
  .legacy-retro{
    position:relative; min-height:100vh; overflow-x:hidden;
    color:${C.ink};
    font-family:'JetBrains Mono',ui-monospace,monospace;
    font-size:16px; font-weight:400; line-height:normal;
    background:linear-gradient(180deg,#b8a5e8 0%,#d8b6e0 30%,#f4c4d8 55%,#ffd2b8 80%,#ffe8c8 100%);
    background-attachment:fixed;
  }
  .legacy-retro *,.legacy-retro *::before,.legacy-retro *::after{image-rendering:pixelated}
  .legacy-retro::before{
    content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background-image:
      radial-gradient(circle at 12% 18%, #fff 0 6px, transparent 7px),
      radial-gradient(circle at 14% 16%, #fff 0 8px, transparent 9px),
      radial-gradient(circle at 16% 18%, #fff 0 6px, transparent 7px),
      radial-gradient(circle at 78% 12%, #fff 0 5px, transparent 6px),
      radial-gradient(circle at 80% 13%, #fff 0 7px, transparent 8px),
      radial-gradient(circle at 82% 12%, #fff 0 5px, transparent 6px),
      radial-gradient(circle at 45% 8%, #fff 0 4px, transparent 5px);
    opacity:.7;
  }
  .legacy-retro::after{
    content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background-image:repeating-linear-gradient(0deg,rgba(26,13,46,0.04) 0 1px,transparent 1px 4px);
  }
  .legacy-retro-inner{position:relative;z-index:1;min-height:100vh}
  .pixel{font-family:'Press Start 2P',monospace;letter-spacing:0;line-height:1.4}
  .vt{font-family:'VT323',monospace;letter-spacing:.02em}
  .mono{font-family:'JetBrains Mono',monospace}
  @keyframes blink{50%{opacity:0}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pop{from{transform:scale(.85)}to{transform:scale(1)}}
  @keyframes hammer{0%,100%{transform:rotate(-15deg)}45%{transform:rotate(50deg)}55%{transform:rotate(50deg)}}
  @keyframes spark{0%{opacity:0;transform:scale(0)}30%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.5)}}
  @keyframes drift{from{transform:translateX(-30px)}to{transform:translateX(calc(100vw + 30px))}}
  .fade{animation:pop .25s ease both}
`;

export const fmtTime = (s) => {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

export const timeAgo = (iso) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};
