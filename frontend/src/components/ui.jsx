import { useState, useRef } from "react";
import { C, SHADOW, SHADOW_SM, BORDER, BORDER_SM } from "../lib/theme";
import { useMobile } from "../hooks/useMobile";

// ── pixel sprites ──────────────────────────────────────────────────────────────
export const ANVIL      = ["...........","...XXXXX...","..XGGGGGX..",".XGGGGGGGX.","XGGGGGGGGGX","XGGGGGGGGGX","..XGGGGGX..","...XGGGX...","..XGGGGGX..",".XXXXXXXXX.","XXXXXXXXXXX"];
export const ANVIL_PAL  = { X: C.ink, G: "#888899" };
export const HAMMER     = ["....HHHHHH...","...HKKKKKKH..","..HKKKKKKKKH.","..HKKKKKKKKH.","...HKKKKKKH..","....HHWWHH...",".....HWWH....",".....HWWH....",".....HWWH....",".....HWWH...."];
export const HAMMER_PAL = { H: C.ink, K: "#aa6644", W: "#7a4a2a" };

export const PixelSprite = ({ data, size = 4, palette, style }) => {
  const cols = data[0].length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},${size}px)`, gridAutoRows: `${size}px`, ...style }}>
      {data.flatMap((row, ri) => row.split("").map((ch, ci) => (
        <div key={`${ri}-${ci}`} style={{ background: ch === "." ? "transparent" : palette[ch] || "transparent" }} />
      )))}
    </div>
  );
};

// ── PixelBtn ───────────────────────────────────────────────────────────────────
export function PixelBtn({ color = "signal", size = "md", full, children, onClick, disabled, type, style: ext, onMouseEnter, onMouseLeave }) {
  const colors = {
    signal:   { bg: C.signal,   deep: C.signalDeep },
    hot:      { bg: C.hot,      deep: C.hotDeep },
    amber:    { bg: C.amber,    deep: C.amberDeep },
    lavender: { bg: C.lavender, deep: C.lavenderDeep },
    cream:    { bg: C.cream,    deep: "#c4b88e" },
    yt:       { bg: C.yt,       deep: C.ytDeep },
    tt:       { bg: C.tt,       deep: C.ttDeep },
    danger:   { bg: "#ff8888",  deep: "#cc4444" },
  }[color];
  const s = { sm: { p: "6px 12px", f: 9 }, md: { p: "10px 18px", f: 10 }, lg: { p: "14px 24px", f: 11 } }[size];
  const [pressed, setPressed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);  // synchronous guard so rapid clicks can't slip through
  const off = pressed ? 0 : 4;

  // Debounce every click: ignore re-clicks while the handler runs (and for a short
  // cooldown after). If onClick returns a promise, stay disabled until it settles.
  // Prevents button-spam from flooding the backend (e.g. queueing 50 jobs).
  const handleClick = async (e) => {
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onClick?.(e);
    } finally {
      setTimeout(() => { busyRef.current = false; setBusy(false); }, 600);
    }
  };

  const isDisabled = disabled || busy;
  return (
    <button
      type={type} onClick={handleClick} disabled={isDisabled}
      onMouseEnter={onMouseEnter}
      onMouseDown={() => setPressed(true)} onMouseUp={() => setPressed(false)}
      onMouseLeave={(e) => { setPressed(false); onMouseLeave?.(e); }}
      className="pixel"
      style={{
        background: colors.bg, color: C.ink, padding: s.p, fontSize: s.f,
        border: BORDER, boxShadow: `${off}px ${off}px 0 ${C.ink}`,
        transform: `translate(${pressed ? 4 : 0}px,${pressed ? 4 : 0}px)`,
        cursor: isDisabled ? "not-allowed" : "pointer", opacity: isDisabled ? .5 : 1,
        width: full ? "100%" : "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        textTransform: "uppercase", transition: "transform .04s,box-shadow .04s",
        userSelect: "none", ...ext,
      }}
    >{children}</button>
  );
}

// ── PixelCard ──────────────────────────────────────────────────────────────────
export const PixelCard = ({ children, color = C.cream, padding = 24, style, ...p }) => (
  <div style={{ background: color, border: BORDER, boxShadow: SHADOW, padding, position: "relative", ...style }} {...p}>{children}</div>
);

// ── Tag ───────────────────────────────────────────────────────────────────────
export const Tag = ({ children, color = C.ink, bg = C.cream2 }) => (
  <span className="pixel" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 8, color, background: bg, padding: "4px 8px", border: `2px solid ${C.ink}`, boxShadow: `2px 2px 0 ${C.ink}`, textTransform: "uppercase" }}>{children}</span>
);

// ── Field + NumField ───────────────────────────────────────────────────────────
export const Field = ({ label, children }) => (
  <div>
    <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);

export function NumField({ label, suffix, value, setValue, min, max, step, bg }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", border: BORDER, boxShadow: SHADOW_SM, background: bg, minWidth: 0 }}>
        <button onClick={() => setValue(Math.max(min, value - step))} className="pixel" style={{ width: 32, padding: "10px 0", background: "transparent", borderRight: `2px solid ${C.ink}`, fontSize: 14, cursor: value > min ? "pointer" : "not-allowed", color: value > min ? C.ink : C.dim }}>-</button>
        <div className="pixel" style={{ flex: 1, textAlign: "center", padding: "10px 0", fontSize: 16, color: C.ink }}>{value}{suffix || ""}</div>
        <button onClick={() => setValue(Math.min(max, value + step))} className="pixel" style={{ width: 32, padding: "10px 0", background: "transparent", borderLeft: `2px solid ${C.ink}`, fontSize: 14, cursor: value < max ? "pointer" : "not-allowed", color: value < max ? C.ink : C.dim }}>+</button>
      </div>
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────
export function Toggle({ on, setOn, label, hint }) {
  return (
    <button onClick={() => setOn(!on)} className="pixel" style={{
      textAlign: "left", padding: 14, minWidth: 0,
      background: on ? C.signal : C.paper,
      color: C.ink, border: BORDER,
      boxShadow: on ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
      cursor: "pointer", transform: on ? "translate(2px,2px)" : "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10 }}>{label}</span>
        <div style={{ width: 18, height: 10, background: on ? C.ink : C.cream2, border: `2px solid ${C.ink}`, position: "relative" }}>
          <div style={{ position: "absolute", top: -2, left: on ? 6 : -2, width: 8, height: 10, background: on ? C.signal : C.dim, border: `2px solid ${C.ink}`, transition: "left .1s" }} />
        </div>
      </div>
      <div className="vt" style={{ fontSize: 14, color: C.dim2, letterSpacing: 0, textTransform: "none", lineHeight: 1.2 }}>{hint}</div>
    </button>
  );
}

// ── ProgressBar ───────────────────────────────────────────────────────────────
export const ProgressBar = ({ progress, color = C.hot }) => (
  <div style={{ height: 24, background: C.paper, border: BORDER, padding: 3 }}>
    <div style={{ height: "100%", width: `${progress}%`, background: color, borderRight: `2px solid ${C.ink}`, transition: "width .08s linear", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(45deg,rgba(0,0,0,.12) 0 4px,transparent 4px 8px)" }} />
    </div>
  </div>
);

// ── Phase constants ───────────────────────────────────────────────────────────
export const PHASE_BLOCKS = [
  { key: "downloading",  label: "DOWNLOAD",   short: "DL",  color: C.hot },
  { key: "merging",      label: "MERGE",      short: "MX",  color: C.peach },
  { key: "transcribing", label: "TRANSCRIBE", short: "TX",  color: C.amber },
  { key: "analyzing",    label: "ANALYZE",    short: "AN",  color: C.lavender },
  { key: "clipping",     label: "CLIP",       short: "CLP", color: C.signal },
];

export const PHASE_RANGES = {
  downloading:  [0,  37],
  merging:      [37, 40],
  transcribing: [40, 65],
  analyzing:    [65, 77],
  clipping:     [77, 100],
};

// ── PhaseSteps ────────────────────────────────────────────────────────────────
export function PhaseSteps({ status }) {
  const isDone = status === "done";
  const currentIdx = PHASE_BLOCKS.findIndex(s => s.key === status);
  const isMobile = useMobile();
  return (
    <div style={{ display: "flex", gap: isMobile ? 4 : 6 }}>
      {PHASE_BLOCKS.map((step, i) => {
        const isActive   = !isDone && i === currentIdx;
        const isComplete = isDone || i < currentIdx;
        return (
          <div key={step.key} style={{
            flex: 1, minWidth: 0, padding: isMobile ? "8px 2px" : "12px 4px", textAlign: "center",
            background: isComplete || isActive ? step.color : C.cream2,
            border: BORDER,
            boxShadow: isActive ? `4px 4px 0 ${C.ink}` : `2px 2px 0 ${C.ink}`,
            transform: isActive ? "translate(-2px,-2px)" : "none",
            transition: "transform .1s, box-shadow .1s",
            overflow: "hidden",
          }}>
            <div className="pixel" style={{ fontSize: isMobile ? 6 : 7, color: C.ink, overflow: "hidden", textOverflow: "clip", whiteSpace: "nowrap" }}>{isMobile ? step.short : step.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── SegmentedProgressBar ──────────────────────────────────────────────────────
export function SegmentedProgressBar({ displayProgress, status }) {
  const isDone = status === "done";
  const currentIdx = PHASE_BLOCKS.findIndex(b => b.key === status);
  const isMobile = useMobile();
  return (
    <div style={{ display: "flex", gap: isMobile ? 4 : 6 }}>
      {PHASE_BLOCKS.map((block, i) => {
        const [start, end] = PHASE_RANGES[block.key];
        let fill;
        if (isDone || i < currentIdx)      fill = 100;
        else if (i === currentIdx)          fill = Math.min(100, Math.max(0, (displayProgress - start) / (end - start) * 100));
        else                                fill = 0;
        const isActive   = !isDone && i === currentIdx;
        const isComplete = isDone || i < currentIdx;
        return (
          <div key={block.key} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ height: 22, background: C.paper, border: `2px solid ${C.ink}`, padding: 2, position: "relative", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${fill}%`, background: block.color, transition: "width .08s linear", position: "relative", overflow: "hidden" }}>
                {isActive && <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(45deg,rgba(0,0,0,.15) 0 4px,transparent 4px 8px)" }} />}
              </div>
            </div>
            <div className="pixel" style={{ fontSize: 7, textAlign: "center", color: C.ink }}>
              {isActive ? `${Math.round(fill)}%` : isComplete ? "DONE" : "--"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────
export const Row = ({ k, v, color = C.ink }) => (
  <div className="pixel" style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 9 }}>
    <span style={{ color: C.dim2 }}>{k}</span><span style={{ color }}>{v}</span>
  </div>
);
