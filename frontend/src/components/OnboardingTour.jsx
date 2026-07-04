import { useEffect, useState } from "react";
import { C, BORDER, SHADOW } from "../lib/theme";
import { PixelBtn } from "./ui";

// First-visit guided tour: spotlights one control at a time with an arrowed
// tooltip explaining what it does. Pure CSS/DOM — the spotlight is a fixed div
// over the target whose giant box-shadow dims everything else. Completion is
// remembered per browser (localStorage), so it runs once after signup.
export default function OnboardingTour({ steps, storageKey = "cf_tour_v1" }) {
  const [step, setStep] = useState(() =>
    typeof window !== "undefined" && !localStorage.getItem(storageKey) ? 0 : -1);
  const [rect, setRect] = useState(null);

  const finish = () => { localStorage.setItem(storageKey, "1"); setStep(-1); };

  useEffect(() => {
    if (step < 0 || step >= steps.length) return;
    const el = document.querySelector(steps[step].target);
    if (!el) { setStep(s => s + 1 < steps.length ? s + 1 : (finish(), -1)); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    let raf;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      raf = requestAnimationFrame(measure);   // follows the smooth scroll
    };
    const t = setTimeout(() => cancelAnimationFrame(raf), 900);
    measure();
    const stop = () => { cancelAnimationFrame(raf); };
    window.addEventListener("resize", measure);
    return () => { stop(); clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [step]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (step < 0 || step >= steps.length || !rect) return null;
  const s = steps[step];
  const pad = 6;
  const below = rect.top + rect.height + 170 < window.innerHeight;
  const tipTop = below ? rect.top + rect.height + pad + 14 : undefined;
  const tipBottom = below ? undefined : window.innerHeight - rect.top + pad + 14;
  const tipLeft = Math.max(12, Math.min(rect.left, window.innerWidth - 320));

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
      <div style={{ position: "fixed", inset: 0, zIndex: 401 }} onClick={() => {}} />
      {/* arrow */}
      <div className="pixel" style={{
        position: "fixed", zIndex: 402, color: C.signal, fontSize: 14,
        left: tipLeft + 18,
        ...(below ? { top: rect.top + rect.height + pad } : { bottom: window.innerHeight - rect.top + pad }),
      }}>
        {below ? "▲" : "▼"}
      </div>
      {/* tooltip */}
      <div className="pixel" style={{
        position: "fixed", zIndex: 402, width: 300, maxWidth: "calc(100vw - 24px)",
        left: tipLeft, ...(below ? { top: tipTop } : { bottom: tipBottom }),
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
