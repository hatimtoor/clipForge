import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

const TIP_W = 300;
const TIP_H = 190;

/* Token-styled first-visit tour for redesigned pages (legacy pages keep the
   original OnboardingTour). Measurement / scroll-blocking / absent-target
   logic is copied verbatim from OnboardingTour — only the visuals changed. */
export function Tour({ steps, storageKey }) {
  const [step, setStep] = useState(() =>
    typeof window !== "undefined" && !localStorage.getItem(storageKey) ? 0 : -1
  );
  const [rect, setRect] = useState(null);

  const active = step >= 0 && step < steps.length;
  const finish = () => {
    localStorage.setItem(storageKey, "1");
    setStep(-1);
  };

  useEffect(() => {
    if (!active) return;
    const sel = steps[step].target;
    let raf,
      scrolled = false;
    const measure = () => {
      const el = document.querySelector(sel);
      if (el) {
        if (!scrolled) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          scrolled = true;
        }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    const absent = setTimeout(() => {
      if (!document.querySelector(sel))
        setStep((s) => (s + 1 < steps.length ? s + 1 : (finish(), -1)));
    }, 1500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(absent);
    };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return;
    const block = (e) => e.preventDefault();
    const keyBlock = (e) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key))
        e.preventDefault();
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
  const vw = window.innerWidth,
    vh = window.innerHeight;

  const fitsBelow = rect.top + rect.height + pad + TIP_H + 24 < vh;
  const fitsAbove = rect.top - pad - TIP_H - 24 > 0;
  let tipTop;
  if (fitsBelow) tipTop = rect.top + rect.height + pad + 14;
  else if (fitsAbove) tipTop = rect.top - pad - TIP_H - 2;
  else tipTop = Math.max(12, Math.min(vh - TIP_H - 12, rect.top + 40));
  tipTop = Math.max(12, Math.min(tipTop, vh - TIP_H - 12));
  const tipLeft = Math.max(12, Math.min(rect.left, vw - TIP_W - 20));

  return createPortal(
    <>
      <div
        style={{
          position: "fixed",
          zIndex: 950,
          pointerEvents: "none",
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          boxShadow: "0 0 0 9999px var(--modal-backdrop)",
          border: "2px dashed var(--accent)",
          borderRadius: "var(--radius-md)",
        }}
      />
      <div
        style={{ position: "fixed", inset: 0, zIndex: 951 }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.preventDefault()}
      />
      <div
        style={{
          position: "fixed",
          zIndex: 952,
          width: TIP_W,
          maxWidth: "calc(100vw - 24px)",
          left: tipLeft,
          top: tipTop,
          background: "var(--surface-1)",
          border: "var(--border-w) solid var(--card-border-color)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-pop)",
          padding: 16,
        }}
      >
        <div className="t-label" style={{ marginBottom: 6 }}>
          {step + 1} / {steps.length} — Getting started
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--fs-h3)",
            fontWeight: "var(--fw-heading)",
            textTransform: "var(--tt-label)",
            color: "var(--text-1)",
            marginBottom: 6,
          }}
        >
          {s.title}
        </div>
        <p
          style={{
            fontSize: "var(--fs-sm)",
            color: "var(--text-2)",
            lineHeight: 1.45,
            margin: "0 0 14px",
          }}
        >
          {s.text}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" onClick={() => (step + 1 < steps.length ? setStep(step + 1) : finish())}>
            {step + 1 < steps.length ? "Next →" : "✓ Got it"}
          </Button>
          <Button size="sm" variant="ghost" onClick={finish}>
            Skip tour
          </Button>
        </div>
      </div>
    </>,
    document.body
  );
}
