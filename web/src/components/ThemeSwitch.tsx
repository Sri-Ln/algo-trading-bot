import { useTheme, type ThemePref } from "../lib/theme";

const ICON: Record<ThemePref, React.ReactNode> = {
  system: (
    <>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M5.5 14.5h5M8 11.5v3" />
    </>
  ),
  light: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4" />
    </>
  ),
  dark: <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />,
};

const OPTIONS: [ThemePref, string][] = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

/** System / Light / Dark switch for the status bar; the choice is kept in localStorage. */
export function ThemeSwitch() {
  const { pref, setPref } = useTheme();
  return (
    <span className="seg theme" role="group" aria-label="Color theme">
      {OPTIONS.map(([value, label]) => (
        <button key={value} type="button" aria-pressed={pref === value} aria-label={`${label} theme`} onClick={() => setPref(value)}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            {ICON[value]}
          </svg>
        </button>
      ))}
    </span>
  );
}
