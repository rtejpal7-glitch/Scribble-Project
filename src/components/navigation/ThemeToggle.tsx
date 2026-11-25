import { useTheme, type ThemePreference } from '../../theme/theme';

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemePreference, string> = {
  system: 'Theme: automatic (follows your device)',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

const Sun = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const Moon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.99 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.78 9.79Z" />
  </svg>
);
const Auto = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
  </svg>
);

/** Cycles automatic → light → dark. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setPreference(NEXT[preference])}
      title={`${LABEL[preference]} — tap to change`}
      aria-label={`${LABEL[preference]}. Change theme`}
      data-theme-preference={preference}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      {preference === 'system' ? <Auto /> : preference === 'light' ? <Sun /> : <Moon />}
    </button>
  );
}
