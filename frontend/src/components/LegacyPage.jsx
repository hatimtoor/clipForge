import { KEYFRAMES } from "../lib/theme";

/* Wraps every not-yet-redesigned page (App.jsx applies it at the route level).
   Paints the original pixel-forge sky/clouds/scanlines locally and injects the
   legacy KEYFRAMES once, so these pages look exactly as before regardless of
   the v2 theme toggle. Delete when the last legacy page is redesigned. */
export default function LegacyPage({ children }) {
  return (
    <div className="legacy-retro">
      <style>{KEYFRAMES}</style>
      <div className="legacy-retro-inner">{children}</div>
    </div>
  );
}
