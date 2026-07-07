import { useSyncExternalStore } from "react";
import { getTheme, subscribeTheme } from "../lib/themeState";

/* Returns "modern" | "retro" and re-renders on toggle. Only use in components
   that must branch in JSX (sprites, FAB label) — styling belongs in CSS. */
export function useTheme() {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
