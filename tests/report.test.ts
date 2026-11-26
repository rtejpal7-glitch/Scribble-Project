import { describe, expect, it } from 'vitest';
import { emptyReport, normalizeReport, reportFromServer, reportToText, textHash } from '../src/clinical/report';
import { createVoiceDocument, initialVoiceState, normalizeVoiceDocument, voiceReducer } from '../src/state/voiceReducer';
import type { ServerReport } from '../src/types/report';

const draft: ServerReport = {
  patient: { name: 'Rahul', age: '32', sex: 'male' },
  chief_complaints: [{ complaint: 'Itching', duration: '2 weeks' }],
  history: '',
  examination: 'Red papules',
  diagnosis: [{ text: 'Allergic dermatitis', source: 'allergic dermatitis', flags: [] }],
  medicines: [
    { name: 'Cetirizine', strength: '10 mg', dose: '1 tablet', frequency: 'at night', timing: 'after food', duration: '5 days', route: 'oral', instructions: '', source: 'cetirizine', flags: [] },
  ],
  investigations: ['CBC'],
  advice: ['Avoid hot water'],
  follow_up: 'After 2 weeks',
  unclear: [],
};

describe('consultation report', () => {
  it('builds an unreviewed report from the server draft', () => {
    const r = reportFromServer(draft, { model: 'm', transcriptHash: textHash('x') });
    expect(r.reviewed).toBe(false);
    expect(r.complaints).toBe('Itching (2 weeks)');
    expect(r.medicines[0].id).toBeTruthy();
    expect(r.transcriptHash).toBe(textHash('x'));
  });

  it('keeps patient details the doctor typed when regenerating', () => {
    const prev = { ...emptyReport(), reviewed: true, patient: { name: 'Rahul Verma', age: '', sex: '' } };
    const r = reportFromServer(draft, { model: 'm', transcriptHash: 'h' }, prev);
    expect(r.patient).toEqual({ name: 'Rahul Verma', age: '32', sex: 'male' });
    expect(r.reviewed).toBe(false);
  });

  it('text export marks drafts and lists the prescription', () => {
    const r = reportFromServer(draft, { model: 'm', transcriptHash: 'h' });
    const text = reportToText(r, { clinicName: 'Clinic', address: '', phone: '', doctorName: 'Dr. A', qualification: 'MBBS', registrationNo: '' });
    expect(text).toContain('1. Cetirizine 10 mg — 1 tablet, at night, after food, for 5 days');
    expect(text).toContain('DRAFT');
    expect(reportToText({ ...r, reviewed: true })).not.toContain('DRAFT');
  });

  it('hash changes with the transcript', () => {
    expect(textHash('a b')).not.toBe(textHash('a c'));
    expect(textHash('same')).toBe(textHash('same'));
  });

  it('is stored on the voice document, outside the transcript undo history', () => {
    let s = voiceReducer(initialVoiceState, { type: 'load', doc: createVoiceDocument() });
    const r = reportFromServer(draft, { model: 'm', transcriptHash: 'h' });
    s = voiceReducer(s, { type: 'setReport', report: r });
    expect(s.doc!.report!.medicines).toHaveLength(1);
    expect(s.undo).toHaveLength(0);
    expect(normalizeVoiceDocument(JSON.parse(JSON.stringify(s.doc))).report!.patient.name).toBe('Rahul');
    s = voiceReducer(s, { type: 'setReport', report: null });
    expect(s.doc!.report).toBeUndefined();
    expect(normalizeReport({ patient: { name: 'x' } })!.medicines).toEqual([]);
  });
});
