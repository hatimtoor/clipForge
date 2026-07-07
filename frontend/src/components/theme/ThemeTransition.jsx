import { useEffect, useRef, useState } from "react";
import { getTheme, setTheme } from "../../lib/themeState";

const BLOCK = 48; // px per pixel-block
const STEP_MS = 10; // stagger per Manhattan step from the origin corner
const BLOCK_ANIM_MS = 240;

/* Ink of the TARGET theme — blocks are painted in the color of the skin
   being revealed. Checkerboard second tone adds pixel texture. */
const INKS = {
  retro: ["#1a0d2e", "#2a1d4a"],
  modern: ["#1c1917", "#2b2724"],
};

let triggerFn = null;
/* Imperative trigger used by the FAB (event-driven, StrictMode-safe). */
export function triggerThemeTransition() {
  if (triggerFn) triggerFn();
  else setTheme(getTheme() === "retro" ? "modern" : "retro"); // not mounted — plain swap
}

export default function ThemeTransition() {
  const [grid, setGrid] = useState(null); // {cols, rows, phase, target}
  const running = useRef(false);
  const timers = useRef([]);

  useEffect(() => {
    const start = () => {
      if (running.current) return;
      const target = getTheme() === "retro" ? "modern" : "retro";
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setTheme(target);
        return;
      }
      running.current = true;
      const cols = Math.ceil(window.innerWidth / BLOCK);
      const rows = Math.ceil(window.innerHeight / BLOCK);
      const maxDelay = (cols - 1 + rows - 1) * STEP_MS;
      setGrid({ cols, rows, phase: "in", target });
      timers.current.push(
        setTimeout(() => {
          setTheme(target); // screen fully covered — swap the skin underneath
          setGrid((g) => g && { ...g, phase: "out" });
          timers.current.push(
            setTimeout(() => {
              setGrid(null);
              running.current = false;
            }, maxDelay + BLOCK_ANIM_MS + 50)
          );
        }, maxDelay + BLOCK_ANIM_MS + 50)
      );
    };
    triggerFn = start;
    return () => {
      if (triggerFn === start) triggerFn = null;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      running.current = false;
    };
  }, []);

  if (!grid) return null;
  const { cols, rows, phase, target } = grid;
  const [ink, ink2] = INKS[target];

  return (
    <div
      className="tt-overlay"
      aria-hidden="true"
      style={{
        gridTemplateColumns: `repeat(${cols}, ${BLOCK}px)`,
        gridAutoRows: `${BLOCK}px`,
      }}
    >
      {Array.from({ length: cols * rows }, (_, i) => {
        const c = i % cols;
        const r = (i / cols) | 0;
        // Manhattan distance from the BOTTOM-RIGHT corner drives the sweep.
        const delay = (cols - 1 - c + (rows - 1 - r)) * STEP_MS;
        return (
          <div
            key={i}
            className={`tt-block ${phase === "in" ? "tt-block--in" : "tt-block--out"}`}
            style={{
              background: (c + r) % 2 ? ink2 : ink,
              animationDelay: `${delay}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
