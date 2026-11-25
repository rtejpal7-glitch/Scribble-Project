import { useSyncExternalStore } from 'react';
import { BUILT_IN_MEDICINES } from './medicines';
import { MedicineMatcher } from './medicineMatcher';

/**
 * Shared medicine dictionary for both workspaces: built-in generics + the
 * clinic's own list (brands, formulary) + words the user marked "not a
 * medicine". Stored in this browser. A host app (ClinicFlow) can call
 * setCustomMedicines() with its formulary instead.
 */
export interface MedicineSettings {
  useBuiltIn: boolean;
  custom: string[];
  allowed: string[];
}

const KEY = 'inkflow:medicines';
const listeners = new Set<() => void>();

function load(): MedicineSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<MedicineSettings>;
      return { useBuiltIn: v.useBuiltIn !== false, custom: v.custom ?? [], allowed: v.allowed ?? [] };
    }
  } catch {
    /* ignore */
  }
  return { useBuiltIn: true, custom: [], allowed: [] };
}

let settings: MedicineSettings = typeof window === 'undefined' ? { useBuiltIn: true, custom: [], allowed: [] } : load();
let matcher = build();

function build(): MedicineMatcher {
  return new MedicineMatcher([...settings.custom, ...(settings.useBuiltIn ? BUILT_IN_MEDICINES : [])], settings.allowed);
}

function commit(next: MedicineSettings) {
  settings = next;
  matcher = build();
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore (quota) */
  }
  listeners.forEach((l) => l());
}

/** Splits pasted text / CSV / one-per-line into names. */
export function parseMedicineList(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,;\t]+/)
        .map((s) => s.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' '))
        .filter((s) => s.length >= 3 && /[A-Za-z]/.test(s)),
    ),
  );
}

export const medicineStore = {
  get: () => settings,
  matcher: () => matcher,
  setCustomMedicines(names: string[]) {
    commit({ ...settings, custom: Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))) });
  },
  setUseBuiltIn(useBuiltIn: boolean) {
    commit({ ...settings, useBuiltIn });
  },
  /** "Not a medicine": never flag this word again. */
  allow(word: string) {
    if (!settings.allowed.includes(word.toLowerCase())) commit({ ...settings, allowed: [...settings.allowed, word.toLowerCase()] });
  },
  clearAllowed() {
    commit({ ...settings, allowed: [] });
  },
  builtInCount: BUILT_IN_MEDICINES.length,
};

export const setCustomMedicines = medicineStore.setCustomMedicines;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useMedicineMatcher(): MedicineMatcher {
  return useSyncExternalStore(subscribe, medicineStore.matcher, medicineStore.matcher);
}

export function useMedicineSettings(): MedicineSettings {
  return useSyncExternalStore(subscribe, medicineStore.get, medicineStore.get);
}
