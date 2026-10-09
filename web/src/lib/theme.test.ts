// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, readTheme, THEME_KEY, writeTheme } from "./theme";

const blocked = (): Storage => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};
const throwing = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
} as unknown as Storage;

beforeEach(() => {
  localStorage.clear();
  applyTheme("system");
});

describe("stored theme preference", () => {
  it("defaults to system", () => {
    expect(readTheme()).toBe("system");
  });

  it("round-trips each choice", () => {
    for (const pref of ["light", "dark", "system"] as const) {
      writeTheme(pref);
      expect(localStorage.getItem(THEME_KEY)).toBe(pref);
      expect(readTheme()).toBe(pref);
    }
  });

  it("ignores values it does not know", () => {
    localStorage.setItem(THEME_KEY, "sepia");
    expect(readTheme()).toBe("system");
  });

  it("falls back to system when storage throws", () => {
    expect(readTheme(blocked)).toBe("system");
    expect(readTheme(() => throwing)).toBe("system");
    expect(() => writeTheme("dark", blocked)).not.toThrow();
    expect(() => writeTheme("dark", () => throwing)).not.toThrow();
  });
});

describe("applyTheme", () => {
  it("sets data-theme and color-scheme, and clears both for system", () => {
    const root = document.documentElement;
    applyTheme("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    applyTheme("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
    applyTheme("system");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.style.colorScheme).toBe("");
  });
});

// The dark tokens appear twice (OS-driven and chosen), since CSS cannot share one block
// between a media query and a plain rule. These checks keep them identical.
describe("theme tokens in styles.css", () => {
  const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(selector + " {");
    expect(start, selector).toBeGreaterThanOrEqual(0);
    const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
    return Object.fromEntries(
      body
        .split(";")
        .map((d) => d.split(":").map((s) => s.trim()))
        .filter(([k]) => k),
    );
  };
  const DARK = {
    "color-scheme": "dark",
    "--bg": "#0a0e14", "--panel": "#111720", "--sunk": "#161e29", "--ink": "#e4e9f0", "--muted": "#96a2b3",
    "--faint": "#6b7789", "--line": "#222c39", "--accent": "#7c9cff", "--on-accent": "#0b1220",
    "--ok": "#3fcb7e", "--warn": "#e6a43c", "--err": "#f06a6a", "--bench": "#6f7b8c",
    "--on": "#f0a04b", "--rising": "#b183ec", "--falling": "#3db7bb",
    "--tip-bg": "#e9eef5", "--tip-ink": "#111a27", "--tip-muted": "#4e5a6b",
  };
  const LIGHT = {
    "color-scheme": "light",
    "--bg": "#f2f4f7", "--panel": "#ffffff", "--sunk": "#eef1f5", "--ink": "#111a27", "--muted": "#5d6878",
    "--faint": "#8a94a3", "--line": "#dde2e9", "--accent": "#3157d5", "--on-accent": "#ffffff",
    "--ok": "#1e9a57", "--warn": "#c7861a", "--err": "#cf4040", "--bench": "#8c96a4",
    "--on": "#d07a1f", "--rising": "#8549c6", "--falling": "#16878c",
    "--tip-bg": "#111a27", "--tip-ink": "#f1f4f8", "--tip-muted": "#a9b4c3",
  };

  it("keeps the dark values in both dark blocks", () => {
    expect(block(':root:not([data-theme="light"])')).toEqual(DARK);
    expect(block(':root[data-theme="dark"]')).toEqual(DARK);
  });

  it("keeps the light values for the default and the chosen light theme", () => {
    expect(block(':root,\n:root[data-theme="light"]')).toEqual(LIGHT);
  });
});
