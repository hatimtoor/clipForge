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
