import { useEffect, useState } from "react";
import { C, SHADOW } from "../lib/theme";
import { PixelBtn } from "./ui";

const TIP_W = 300;
const TIP_H = 200;   // conservative tooltip height estimate for clamping

// First-visit guided tour: spotlights one control at a time with an arrowed
// tooltip explaining what it does. The spotlight is re-measured every frame so
// it stays glued to its target through async content loads and reflows; user
// scrolling and clicking are blocked while the tour runs (SKIP exits).
// Completion is remembered per browser (localStorage).
export default function OnboardingTour({ steps, storageKey = "cf_tour_v1" }) {
  const [step, setStep] = useState(() =>
    typeof window !== "undefined" && !localStorage.getItem(storageKey) ? 0 : -1);
  const [rect, setRect] = useState(null);

  const active = step >= 0 && step < steps.length;
  const finish = () => { localStorage.setItem(storageKey, "1"); setStep(-1); };

  // Follow the target continuously — async data loads shift layouts long
  // after the step starts, and the spotlight must move with them.
  useEffect(() => {
    if (!active) return;
    const sel = steps[step].target;
    let raf, scrolled = false;
    const measure = () => {
      const el = document.querySelector(sel);
      if (el) {
        if (!scrolled) { el.scrollIntoView({ behavior: "smooth", block: "center" }); scrolled = true; }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    // Target genuinely absent (feature hidden on this account) → skip the step
    // after giving async content a moment to arrive.
    const absent = setTimeout(() => {
      if (!document.querySelector(sel)) setStep(s => (s + 1 < steps.length ? s + 1 : (finish(), -1)));
    }, 1500);
    return () => { cancelAnimationFrame(raf); clearTimeout(absent); };
  }, [step]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Block user scrolling and page interaction while the tour runs. Wheel,
  // touch, and scroll keys are prevented (programmatic scrollIntoView still
  // works); the click shield below eats stray clicks.
  useEffect(() => {
    if (!active) return;
    const block = (e) => e.preventDefault();
    const keyBlock = (e) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.preventDefault();
    };
    window.addEventListener("wheel", block, { passive: false });
    window.addEventListener("touchmove", block, { passive: false });
    window.addEventListener("keydown", keyBlock);
    return () => {
      window.removeEventListener("wheel", block);
      window.removeEventListener("touchmove", block);
      window.removeEventListener("keydown", keyBlock);
    };
  }, [active]);

  if (!active || !rect) return null;
  const s = steps[step];
  const pad = 6;
  const vw = window.innerWidth, vh = window.innerHeight;

  // Tooltip placement: below the target, else above, else (target taller than
  // the viewport allows) pinned inside the viewport over the target — always
  // fully on screen so NEXT/SKIP stay clickable.
  const fitsBelow = rect.top + rect.height + pad + TIP_H + 24 < vh;
  const fitsAbove = rect.top - pad - TIP_H - 24 > 0;
  let tipTop, arrow = null;
  if (fitsBelow) {
    tipTop = rect.top + rect.height + pad + 14;
    arrow = { ch: "▲", top: rect.top + rect.height + pad };
  } else if (fitsAbove) {
    tipTop = rect.top - pad - TIP_H - 2;
    arrow = { ch: "▼", top: rect.top - pad - 16 };
  } else {
    tipTop = Math.max(12, Math.min(vh - TIP_H - 12, rect.top + 40));
  }
  tipTop = Math.max(12, Math.min(tipTop, vh - TIP_H - 12));
  const tipLeft = Math.max(12, Math.min(rect.left, vw - TIP_W - 20));

  return (
    <>
      {/* spotlight: dims everything except the target */}
      <div style={{
        position: "fixed", zIndex: 400, pointerEvents: "none",
        top: rect.top - pad, left: rect.left - pad,
        width: rect.width + pad * 2, height: rect.height + pad * 2,
        boxShadow: "0 0 0 9999px rgba(26,13,46,.74)",
        border: `2px dashed ${C.signal}`,
      }} />
      {/* click shield so the page doesn't react underneath */}
      <div style={{ position: "fixed", inset: 0, zIndex: 401 }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.preventDefault()} />
      {arrow && (
        <div className="pixel" style={{
          position: "fixed", zIndex: 402, color: C.signal, fontSize: 14,
          left: tipLeft + 18, top: arrow.top, pointerEvents: "none",
        }}>
          {arrow.ch}
        </div>
      )}
      {/* tooltip */}
      <div className="pixel" style={{
        position: "fixed", zIndex: 402, width: TIP_W, maxWidth: "calc(100vw - 24px)",
        left: tipLeft, top: tipTop,
        background: C.cream, border: `3px solid ${C.ink}`, boxShadow: SHADOW, padding: 14,
      }}>
        <div style={{ fontSize: 8, color: C.dim2, marginBottom: 6 }}>
          {step + 1} / {steps.length} — GETTING STARTED
        </div>
        <div style={{ fontSize: 10, color: C.ink, marginBottom: 6, lineHeight: 1.4 }}>{s.title}</div>
        <p className="vt" style={{ fontSize: 16, color: C.dim2, lineHeight: 1.35, margin: "0 0 12px",
          letterSpacing: 0, textTransform: "none" }}>{s.text}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <PixelBtn color="signal" size="sm"
            onClick={() => step + 1 < steps.length ? setStep(step + 1) : finish()}>
            {step + 1 < steps.length ? "NEXT >" : "✓ GOT IT"}
          </PixelBtn>
          <PixelBtn color="cream" size="sm" onClick={finish}>SKIP TOUR</PixelBtn>
        </div>
      </div>
    </>
  );
}
