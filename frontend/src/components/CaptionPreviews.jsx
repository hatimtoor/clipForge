import { useEffect, useState } from "react";
import { C, BORDER, SHADOW_SM, SHADOW } from "../lib/theme";

// ── caption template previews ─────────────────────────────────────────────────
// Mirrors backend CAPTION_TEMPLATES (fonts, colors, case, mode) so pickers show
// what actually gets burned in. Colors are the RGB twins of the ASS BGR values;
// the active word follows the user's highlight-color pick and CYCLES like the
// real karaoke render so the animated styles read as animated.
export const CAPTION_TEMPLATE_PREVIEWS = [
  { id: "bold_bottom",    name: "Bold",      bg: "#F5C24B", font: "ClipForgeCaps", px: 14, weight: 800, active: "#2BFF00", keyword: null,      words: ["BUILD", "REAL", "WEALTH"], animate: true,  stroke: 2.5 },
  { id: "center_pop",     name: "Pop",       bg: "#C9B8F0", font: "ClipForgeCaps", px: 17, weight: 800, active: "#FFFF00", keyword: null,      words: ["BUILD", "REAL", "WEALTH"], animate: true,  stroke: 3 },
  { id: "karaoke",        name: "Karaoke",   bg: "#F5C24B", font: "ClipForgeCaps", px: 15, weight: 800, active: "#FFFF00", keyword: null,      words: ["BUILD", "REAL", "WEALTH"], animate: true,  stroke: 2.5 },
  { id: "hormozi",        name: "Hormozi",   bg: "#7FD8A4", font: "ClipForgeCaps", px: 17, weight: 800, active: "#2BFF00", keyword: "#FFFF00", words: ["BUILD", "REAL", "WEALTH"], animate: true,  stroke: 3.2 },
  { id: "beasty",         name: "Beasty",    bg: "#C9B8F0", font: "Bangers",       px: 19, weight: 400, active: "#FFFF00", keyword: "#FF3131", words: ["BUILD", "REAL", "WEALTH"], animate: true,  stroke: 2.8 },
  { id: "bold_statement", name: "Statement", bg: "#7FD8A4", font: "ClipForgeCaps", px: 13, weight: 800, active: null,      keyword: null,      words: ["BIG", "BOLD", "TAKES"],    animate: false, stroke: 2.5 },
  { id: "simple",         name: "Simple",    bg: "#C9B8F0", font: "Montserrat",    px: 12, weight: 400, active: "#FFFF00", keyword: null,      words: ["clean", "and", "simple"],  animate: true,  stroke: 1, lower: true },
  { id: "minimal",        name: "Minimal",   bg: "#7FD8A4", font: "Montserrat",    px: 12, weight: 400, active: null,      keyword: null,      words: ["SMALL", "AND", "CLEAN"],   animate: false, stroke: 1 },
  { id: "pod_p",          name: "Pod",       bg: "#F5C24B", font: "ClipForgeCaps", px: 12, weight: 800, active: "#00FFFF", keyword: null,      words: ["BUILD", "REAL", "WEALTH"], animate: true,  stroke: 2 },
  { id: "none",           name: "No captions", bg: "#EDE4CE", font: "ClipForgeCaps", px: 12, weight: 800, active: null,    keyword: null,      words: [],                          animate: false, stroke: 0 },
];

// Styles whose font size / highlight colour are user-tunable; the designed
// templates keep their identity.
export const CUSTOMIZABLE_CAPTION_STYLES = ["minimal", "simple"];

export function TplPreview({ id, highlightColor, tick = 0 }) {
  const t = CAPTION_TEMPLATE_PREVIEWS.find(p => p.id === id);
  if (!t) return null;
  const activeColor = highlightColor || t.active;
  const activeIdx = t.animate && t.active ? tick % t.words.length : (t.active ? 1 : -1);
  return (
    <div style={{
      padding: "10px 6px", minHeight: 40,
      display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3em",
      overflow: "hidden", whiteSpace: "nowrap",
    }}>
      {t.words.length === 0 ? (
        <span style={{ color: "#999", fontSize: 11, fontFamily: "monospace" }}>NO CAPTIONS</span>
      ) : t.words.map((w, i) => {
        // Sticker-style outline so white caption text stays legible directly on
        // the light button background.
        const s = t.stroke >= 2 ? 1.6 : 1.0;
        const isActive = i === activeIdx && activeColor;
        return (
          <span key={i} style={{
            fontFamily: `${t.font}, Arial, sans-serif`,
            fontWeight: t.weight,
            fontSize: t.px,
            lineHeight: 1,
            display: "inline-block",
            transform: isActive ? "scale(1.12)" : "scale(1)",
            transition: "transform .15s, color .15s",
            color: isActive ? activeColor : (i === 2 && t.keyword ? t.keyword : "#fff"),
            WebkitTextStroke: t.stroke ? `${s}px #000` : undefined,
            paintOrder: "stroke fill",
            textShadow: t.stroke
              ? `${s}px ${s}px 0 #000, -${s}px ${s}px 0 #000, ${s}px -${s}px 0 #000, -${s}px -${s}px 0 #000, 0 ${s * 1.5}px 0 #000`
              : undefined,
          }}>{w}</span>
        );
      })}
    </div>
  );
}

// Label-free grid of animated template previews. One shared ticker drives every
// preview's active-word cycle.
export function CaptionStyleGrid({ value, onChange, highlightColor, isMobile }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 650);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isMobile ? 6 : 8 }}>
      {CAPTION_TEMPLATE_PREVIEWS.map(({ id, name, bg }) => (
        <button key={id} title={name} onClick={() => onChange(id)} className="pixel"
          style={{ padding: isMobile ? 4 : 6, background: value === id ? bg : C.paper,
            border: value === id ? `3px solid ${C.ink}` : BORDER,
            boxShadow: value === id ? SHADOW : SHADOW_SM, cursor: "pointer", transition: "all .12s" }}>
          <TplPreview id={id} highlightColor={value === id ? highlightColor : null} tick={tick} />
        </button>
      ))}
    </div>
  );
}
