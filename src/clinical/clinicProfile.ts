import { useSyncExternalStore } from 'react';
import type { ClinicProfile } from '../types/report';

/** Clinic / doctor details printed on reports. Stored in this browser only. */
const KEY = 'inkflow:clinic';
const EMPTY: ClinicProfile = { clinicName: '', address: '', phone: '', doctorName: '', qualification: '', registrationNo: '' };
const listeners = new Set<() => void>();

function load(): ClinicProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<ClinicProfile>) };
  } catch {
    /* ignore */
  }
  return EMPTY;
}

let profile: ClinicProfile = typeof window === 'undefined' ? EMPTY : load();

export const clinicStore = {
  get: () => profile,
  set(next: ClinicProfile) {
    profile = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useClinicProfile(): ClinicProfile {
  return useSyncExternalStore(clinicStore.subscribe, clinicStore.get, clinicStore.get);
}
