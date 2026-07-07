import { useTheme } from "../../hooks/useTheme";
import { triggerThemeTransition } from "./ThemeTransition";

/* The "Go Retro" floating toggle — bottom-right, rendered by AppShell so it
   only appears on redesigned pages. */
export default function ThemeFab() {
  const theme = useTheme();
  const retro = theme === "retro";
  return (
    <button
      type="button"
      className="fab"
      onClick={triggerThemeTransition}
      title={retro ? "Back to the modern look" : "Switch to the pixel forge"}
    >
      <span className="fab__dot" aria-hidden="true" />
      {retro ? "Go modern" : "Go retro"}
    </button>
  );
}
