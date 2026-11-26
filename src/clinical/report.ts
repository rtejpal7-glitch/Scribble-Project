import type { ClinicalReport, ClinicProfile, ReportMedicine, ServerReport } from '../types/report';
import { createId } from '../utils/id';

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Small stable hash (FNV-1a) to notice when the transcript changed after a draft was made. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + text.length.toString(36);
}

export function emptyMedicine(): ReportMedicine {
  return { id: createId('m_'), name: '', strength: '', dose: '', frequency: '', timing: '', duration: '', route: '', instructions: '', source: '', flags: [] };
}

export function emptyReport(): ClinicalReport {
  return {
    version: 1,
    generatedAt: null,
    model: null,
    transcriptHash: null,
    updatedAt: Date.now(),
    visitDate: todayIso(),
    patient: { name: '', age: '', sex: '' },
    complaints: '',
    history: '',
    examination: '',
    diagnosis: [],
    medicines: [],
    investigations: '',
    advice: '',
    followUp: '',
    unclear: [],
    reviewed: false,
  };
}

/**
 * Builds a report from the server draft. Patient details the doctor already
 * typed are kept; everything else is replaced and the review is reset.
 */
export function reportFromServer(
  draft: ServerReport,
  meta: { model: string | null; transcriptHash: string },
  previous?: ClinicalReport | null,
): ClinicalReport {
  const keep = (typed: string | undefined, spoken: string) => (typed && typed.trim() ? typed : spoken);
  const prevPatient = previous?.patient;
  return {
    ...emptyReport(),
    generatedAt: Date.now(),
    model: meta.model,
    transcriptHash: meta.transcriptHash,
    visitDate: previous?.visitDate || todayIso(),
    patient: {
      name: keep(prevPatient?.name, draft.patient.name),
      age: keep(prevPatient?.age, draft.patient.age),
      sex: keep(prevPatient?.sex, draft.patient.sex),
    },
    complaints: draft.chief_complaints.map((c) => (c.duration ? `${c.complaint} (${c.duration})` : c.complaint)).join('\n'),
    history: draft.history,
    examination: draft.examination,
    diagnosis: draft.diagnosis.map((d) => ({ id: createId('d_'), text: d.text, source: d.source, flags: d.flags })),
    medicines: draft.medicines.map((m) => ({ ...m, id: createId('m_') })),
    investigations: draft.investigations.join('\n'),
    advice: draft.advice.join('\n'),
    followUp: draft.follow_up,
    unclear: draft.unclear,
    reviewed: false,
  };
}

export function normalizeReport(raw: unknown): ClinicalReport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<ClinicalReport>;
  const base = emptyReport();
  return {
    ...base,
    ...r,
    version: 1,
    patient: { ...base.patient, ...(r.patient ?? {}) },
    diagnosis: Array.isArray(r.diagnosis) ? r.diagnosis : [],
    medicines: Array.isArray(r.medicines) ? r.medicines : [],
    unclear: Array.isArray(r.unclear) ? r.unclear : [],
    reviewed: !!r.reviewed,
  };
}

export const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function medicineLine(m: ReportMedicine): string {
  const head = [m.name, m.strength].filter(Boolean).join(' ');
  const rest = [m.dose, m.route && m.route !== 'oral' ? m.route : '', m.frequency, m.timing, m.duration ? `for ${m.duration}` : '']
    .filter(Boolean)
    .join(', ');
  return [head, rest, m.instructions].filter(Boolean).join(' — ');
}

/** Plain-text version (copy / ClinicFlow). */
export function reportToText(r: ClinicalReport, clinic?: ClinicProfile): string {
  const out: string[] = [];
  if (clinic?.clinicName) out.push(clinic.clinicName);
  if (clinic?.doctorName) out.push([clinic.doctorName, clinic.qualification].filter(Boolean).join(', '));
  if (out.length) out.push('');
  const pt = [r.patient.name && `Patient: ${r.patient.name}`, r.patient.age && `Age: ${r.patient.age}`, r.patient.sex && `Sex: ${r.patient.sex}`]
    .filter(Boolean)
    .join('   ');
  out.push([pt, `Date: ${r.visitDate}`].filter(Boolean).join('   '));
  const section = (title: string, body: string | string[]) => {
    const items = Array.isArray(body) ? body.filter(Boolean) : lines(body);
    if (!items.length) return;
    out.push('', title.toUpperCase());
    items.forEach((i) => out.push(Array.isArray(body) || items.length > 1 ? `- ${i}` : i));
  };
  section('Chief complaints', r.complaints);
  section('History', r.history);
  section('Examination', r.examination);
  section('Diagnosis', r.diagnosis.map((d) => d.text));
  if (r.medicines.some((m) => m.name.trim())) {
    out.push('', 'RX');
    r.medicines.filter((m) => m.name.trim()).forEach((m, i) => out.push(`${i + 1}. ${medicineLine(m)}`));
  }
  section('Investigations', r.investigations);
  section('Advice', r.advice);
  if (r.followUp.trim()) out.push('', `Follow-up: ${r.followUp.trim()}`);
  if (!r.reviewed) out.push('', 'DRAFT — not yet reviewed by the doctor.');
  return out.join('\n');
}
