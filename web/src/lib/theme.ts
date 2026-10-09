import { useCallback, useEffect, useState } from "react";

/** The viewer's theme choice. "system" follows the OS (`prefers-color-scheme`). */
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isPref = (v: unknown): v is ThemePref => v === "system" || v === "light" || v === "dark";

/** Stored choice, or "system" when there is none or storage is blocked (private mode, disabled site data). */
export function readTheme(storage: () => Storage = () => localStorage): ThemePref {
  try {
    const v = storage().getItem(THEME_KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** Saves the choice; a blocked store is ignored, so the choice lasts for this page only. */
export function writeTheme(pref: ThemePref, storage: () => Storage = () => localStorage): void {
  try {
    storage().setItem(THEME_KEY, pref);
  } catch {
    // keep going without persistence
  }
}

const osTheme = (): Theme => (matchMedia(DARK_QUERY).matches ? "dark" : "light");

/**
 * Sets `data-theme` and `color-scheme` on <html>, as the inline script in index.html does
 * before first paint. "system" clears both so the `prefers-color-scheme` rules apply.
 */
export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === "system") {
    delete root.dataset.theme;
    root.style.removeProperty("color-scheme");
  } else {
    root.dataset.theme = pref;
    root.style.colorScheme = pref;
  }
}

/** The theme choice plus the theme actually showing, kept in sync with the OS and other tabs. */
export function useTheme(): { pref: ThemePref; theme: Theme; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(() => readTheme());
  const [os, setOs] = useState<Theme>(osTheme);

  useEffect(() => applyTheme(pref), [pref]);

  useEffect(() => {
    const mq = matchMedia(DARK_QUERY);
    const onOs = () => setOs(mq.matches ? "dark" : "light");
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY || e.key === null) setPrefState(readTheme());
    };
    mq.addEventListener("change", onOs);
    addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onOs);
      removeEventListener("storage", onStorage);
    };
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    writeTheme(p);
    setPrefState(p);
  }, []);

  return { pref, theme: pref === "system" ? os : pref, setPref };
}
