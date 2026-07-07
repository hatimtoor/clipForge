/* Theme source of truth is the data-theme attribute on <html> (set before
   first paint by the inline script in index.html) mirrored to localStorage.
   Deliberately NOT React context — flipping the attribute restyles everything
   via CSS with zero re-renders; only the few components that branch on theme
   (mascots, FAB label) subscribe through useTheme(). */

const listeners = new Set();

export const getTheme = () =>
  document.documentElement.getAttribute("data-theme") === "retro" ? "retro" : "modern";

export function setTheme(next) {
  const t = next === "retro" ? "retro" : "modern";
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("cf_theme", t);
  } catch {
    /* private mode — theme just won't persist */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeTheme(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
