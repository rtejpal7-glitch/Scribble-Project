import { useSyncExternalStore } from 'react';

/** 'system' follows the device's light/dark setting; the others force a theme. */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'inkflow:theme';
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference();
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function resolvedTheme(): 'light' | 'dark' {
  if (preference === 'system') return media?.matches ? 'dark' : 'light';
  return preference;
}

function apply() {
  if (typeof document === 'undefined') return;
  const dark = resolvedTheme() === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16181d' : '#ffffff');
  listeners.forEach((l) => l());
}

media?.addEventListener?.('change', () => {
  if (preference === 'system') apply();
});

export function setThemePreference(p: ThemePreference) {
  preference = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
  apply();
}

export function initTheme() {
  apply();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => preference, () => 'system' as ThemePreference);
  const resolved = useSyncExternalStore(subscribe, resolvedTheme, () => 'light' as const);
  return { preference: pref, resolved, setPreference: setThemePreference };
}
