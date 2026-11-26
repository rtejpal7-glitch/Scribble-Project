import { useMemo, useState, type ReactNode } from 'react';
import type { VoiceDocument } from '../../types/speech';
import { FLAG_TEXT, type ClinicalReport, type ClinicProfile, type ReportDiagnosis, type ReportMedicine } from '../../types/report';
import { emptyMedicine, emptyReport, reportToText, textHash } from '../../clinical/report';
import { clinicStore, useClinicProfile } from '../../clinical/clinicProfile';
import { useMedicineMatcher } from '../../clinical/medicineStore';
import { applyMedicineFix, normalize, type MedicineMatcher } from '../../clinical/medicineMatcher';
import { transcriptText } from '../../state/voiceText';
import type { ReportGenerator } from '../../hooks/useReportGenerator';
import { AutoTextarea } from '../editor/TextBlockEditor';
import { Spinner } from '../editor/RecognitionStatus';
import { AlertIcon, CheckIcon, ChevronLeftIcon, CopyIcon, PlusIcon, RefreshIcon, SparklesIcon, TrashIcon, XIcon } from '../common/icons';
import { formatDuration } from '../voice/MicrophoneControls';
import { ReportPrint, printReport } from './ReportPrint';
import { createId } from '../../utils/id';

export interface ReportPanelProps {
  doc: VoiceDocument;
  generator: ReportGenerator;
  /** Speech still being transcribed (report would miss it). */
  pending: number;
  onChange(report: ClinicalReport | null): void;
  onBack(): void;
  onCopy(text: string): Promise<boolean>;
  confirm(opts: { title: string; message: string; confirmLabel: string; destructive?: boolean }): Promise<boolean>;
}

const input =
  'w-full rounded-lg bg-white px-2.5 py-1.5 text-[14px] text-slate-900 ring-1 ring-slate-300 ring-inset outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500';
const area = `${input} speech-text resize-none leading-relaxed`;

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-[14px] font-semibold text-slate-900">{title}</h3>
        {hint && <span className="hidden text-[12px] text-slate-400 sm:inline">{hint}</span>}
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

function Flag({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'red' | 'slate' }) {
  const cls =
    tone === 'red'
      ? 'bg-red-50 text-red-800 ring-red-200'
      : tone === 'slate'
        ? 'bg-slate-100 text-slate-600 ring-slate-200'
        : 'bg-amber-50 text-amber-900 ring-amber-300';
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${cls}`}>{children}</span>;
}

/** Dictionary status of a medicine name: known, likely misspelt (with fixes), or unknown. */
function dictionaryStatus(matcher: MedicineMatcher, name: string) {
  if (!name.trim() || !matcher.size) return { known: true, issues: [] as ReturnType<MedicineMatcher['check']> };
  const issues = matcher.check(name);
  const words = normalize(name).split(' ');
  let known = false;
  for (let n = Math.min(3, words.length); n >= 1 && !known; n--)
    for (let i = 0; i + n <= words.length; i++) if (matcher.isKnown(words.slice(i, i + n).join(' '))) known = true;
  return { known, issues };
}

const ADD_BTN = 'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-medium text-blue-700 hover:bg-blue-50';

export function ReportPanel(props: ReportPanelProps) {
  const { doc, generator } = props;
  const report = doc.report ?? null;
  const clinic = useClinicProfile();
  const matcher = useMedicineMatcher();
  const [copied, setCopied] = useState(false);

  const transcript = useMemo(() => transcriptText(doc.segments.filter((s) => s.status === 'final')), [doc.segments]);
  const stale = !!report?.transcriptHash && report.transcriptHash !== textHash(transcript);
  const generating = generator.status === 'generating';
  const canGenerate = !generator.unavailableReason && !!transcript.trim() && !generating;

  const set = (patch: Partial<ClinicalReport>) => report && props.onChange({ ...report, ...patch });
  // Editing a field counts as checking it: drop only the warning about that field.
  const setMed = (id: string, patch: Partial<ReportMedicine>) =>
    set({
      medicines: report!.medicines.map((m) => {
        if (m.id !== id) return m;
        const flags = m.flags.filter(
          (f) =>
            !(f === 'name-not-in-transcript' && patch.name !== undefined) &&
            !(f === 'number-not-in-transcript' && (patch.strength !== undefined || patch.duration !== undefined)),
        );
        return { ...m, ...patch, flags };
      }),
    });
  const setDx = (id: string, patch: Partial<ReportDiagnosis>) =>
    set({ diagnosis: report!.diagnosis.map((d) => (d.id === id ? { ...d, ...patch, flags: patch.text !== undefined ? [] : d.flags } : d)) });
  const setClinic = (patch: Partial<ClinicProfile>) => clinicStore.set({ ...clinic, ...patch });

  const regenerate = async () => {
    if (report) {
      const ok = await props.confirm({
        title: 'Create the report again?',
        message: 'A new draft is made from the current transcript. Your edits to this report are replaced (patient details you typed are kept).',
        confirmLabel: 'Create again',
      });
      if (!ok) return;
    }
    void generator.generate();
  };

  const flagCount = report
    ? report.medicines.reduce((n, m) => n + m.flags.length, 0) + report.diagnosis.reduce((n, d) => n + d.flags.length, 0) + report.unclear.length
    : 0;

  /* ------------------------------- top bar ------------------------------- */
  const bar = (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-slate-200 px-2 sm:px-3">
      <button type="button" onClick={props.onBack} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100">
        <ChevronLeftIcon size={16} /> Transcript
      </button>
      <h2 className="ml-1 hidden text-[14px] font-semibold text-slate-900 sm:block">Consultation report</h2>
      <div className="flex-1" />
      {report && (
        <>
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={!canGenerate}
            title={generator.unavailableReason ?? 'Draft the report again from the transcript'}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            <RefreshIcon size={15} /> <span className="hidden md:inline">Create again</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await props.onCopy(reportToText(report, clinic));
              setCopied(ok);
              setTimeout(() => setCopied(false), 1800);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-100"
          >
            {copied ? <CheckIcon size={15} className="text-emerald-600" /> : <CopyIcon size={15} />}
            <span className="hidden md:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button type="button" onClick={printReport} className="btn-primary h-8 px-3 text-[12.5px]" data-testid="print-report">
            Print / PDF
          </button>
          <button
            type="button"
            aria-label="Delete report"
            title="Delete report"
            onClick={async () => {
              const ok = await props.confirm({
                title: 'Delete this report?',
                message: 'The report is removed from this dictation. The transcript is kept.',
                confirmLabel: 'Delete report',
                destructive: true,
              });
              if (ok) props.onChange(null);
            }}
            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <TrashIcon size={16} />
          </button>
        </>
      )}
    </div>
  );

  /* ------------------------------- banners ------------------------------- */
  const banners = (
    <>
      {generating && (
        <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-[13px] text-blue-900 ring-1 ring-blue-200 ring-inset" role="status">
          <Spinner />
          <span className="flex-1">
            Writing the report on your computer… {formatDuration(generator.elapsedMs)}
            <span className="block text-[12px] text-blue-800/80">This usually takes 20–60 seconds; the first report after starting can take longer.</span>
          </span>
          <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" onClick={generator.cancel}>
            Cancel
          </button>
        </div>
      )}
      {generator.status === 'error' && generator.message && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-800 ring-1 ring-red-200 ring-inset">
          <AlertIcon size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">Couldn't create the report: {generator.message}</span>
          <button aria-label="Dismiss" onClick={generator.clearMessage}>
            <XIcon size={14} />
          </button>
        </div>
      )}
      {props.pending > 0 && (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600 ring-1 ring-slate-200 ring-inset">
          Some speech is still being transcribed. Wait for it to finish so the report includes everything.
        </div>
      )}
      {report && stale && !generating && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950 ring-1 ring-amber-300 ring-inset">
          <span className="flex-1">The transcript changed after this report was made. It may be missing the latest dictation.</span>
          <button type="button" className="btn-secondary h-7 px-2.5 text-[12px]" onClick={() => void regenerate()} disabled={!canGenerate}>
            Create again
          </button>
        </div>
      )}
    </>
  );

  /* ------------------------------ empty state ----------------------------- */
  if (!report) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {bar}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-xl space-y-4">
            {banners}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-[16px] font-semibold text-slate-900">Consultation report</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                Turns this dictation into a clinical note with a prescription: complaints, history, examination, diagnosis, medicines with
                dose, frequency and duration, investigations, advice and follow-up.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-600">
                <li>It only organises what was dictated. It never adds a diagnosis, medicine or dose of its own.</li>
                <li>Items it couldn't find in the dictation, and medicine names not in your dictionary, are highlighted for you to check.</li>
                <li>It runs on the language model on your own computer, so the text stays there.</li>
              </ul>
              {generator.unavailableReason && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">{generator.unavailableReason}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={!canGenerate} onClick={() => void generator.generate()} data-testid="create-report">
                  {generating ? <Spinner /> : <SparklesIcon size={16} />} Create report from dictation
                </button>
                <button type="button" className="btn-secondary" onClick={() => props.onChange(emptyReport())}>
                  Start a blank report
                </button>
              </div>
              {!transcript.trim() && <p className="mt-2 text-[12px] text-slate-400">Dictate the consultation first; the transcript is empty.</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* -------------------------------- editor -------------------------------- */
  return (
    <div className="flex h-full min-h-0 flex-col">
      {bar}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5" data-testid="report">
        <div className="mx-auto max-w-4xl space-y-4">
          {banners}

          <div
            className={`rounded-xl px-4 py-3 text-[13px] ring-1 ring-inset ${
              report.reviewed ? 'bg-emerald-50 text-emerald-950 ring-emerald-200' : 'bg-amber-50 text-amber-950 ring-amber-300'
            }`}
          >
            {report.generatedAt && (
              <p className="leading-snug">
                Drafted by a local AI model ({report.model ?? 'unknown'}) from the dictation. It can miss or misread things: check every item,
                especially medicines, doses and durations, against what was said.
                {flagCount > 0 && <b> {flagCount} item{flagCount === 1 ? '' : 's'} need checking (highlighted).</b>}
              </p>
            )}
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={report.reviewed} onChange={(e) => set({ reviewed: e.target.checked })} data-testid="reviewed" />
              I have reviewed and corrected this report
            </label>
            {!report.reviewed && <p className="mt-1 text-[12px] opacity-80">Until then, printouts are marked "Draft — not reviewed".</p>}
          </div>

          {report.unclear.length > 0 && (
            <Section title="Please check" hint="parts of the dictation the model couldn't make sense of">
              <ul className="space-y-1.5">
                {report.unclear.map((u, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-amber-950">
                    <AlertIcon size={14} className="mt-0.5 shrink-0 text-amber-600" />
                    <span className="speech-text flex-1">{u}</span>
                    <button aria-label="Dismiss" title="Done" className="text-slate-400 hover:text-slate-700" onClick={() => set({ unclear: report.unclear.filter((_, j) => j !== i) })}>
                      <XIcon size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <details className="rounded-xl border border-slate-200 bg-white p-4 [&[open]>summary]:mb-3">
            <summary className="cursor-pointer text-[14px] font-semibold text-slate-900">
              Clinic & doctor details <span className="text-[12px] font-normal text-slate-400">printed at the top · saved on this device</span>
            </summary>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Clinic name"><input className={input} value={clinic.clinicName} onChange={(e) => setClinic({ clinicName: e.target.value })} /></Field>
              <Field label="Phone"><input className={input} value={clinic.phone} onChange={(e) => setClinic({ phone: e.target.value })} /></Field>
              <Field label="Address" className="sm:col-span-2"><input className={input} value={clinic.address} onChange={(e) => setClinic({ address: e.target.value })} /></Field>
              <Field label="Doctor's name"><input className={input} value={clinic.doctorName} onChange={(e) => setClinic({ doctorName: e.target.value })} placeholder="Dr. …" /></Field>
              <Field label="Qualification"><input className={input} value={clinic.qualification} onChange={(e) => setClinic({ qualification: e.target.value })} placeholder="MBBS, MD" /></Field>
              <Field label="Registration no."><input className={input} value={clinic.registrationNo} onChange={(e) => setClinic({ registrationNo: e.target.value })} /></Field>
            </div>
          </details>

          <Section title="Patient">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1.2fr]">
              <Field label="Name"><input className={input} value={report.patient.name} onChange={(e) => set({ patient: { ...report.patient, name: e.target.value } })} data-testid="patient-name" /></Field>
              <Field label="Age"><input className={input} value={report.patient.age} onChange={(e) => set({ patient: { ...report.patient, age: e.target.value } })} /></Field>
              <Field label="Sex">
                <input className={input} list="report-sex" value={report.patient.sex} onChange={(e) => set({ patient: { ...report.patient, sex: e.target.value } })} />
                <datalist id="report-sex"><option value="Male" /><option value="Female" /><option value="Other" /></datalist>
              </Field>
              <Field label="Date"><input type="date" className={input} value={report.visitDate} onChange={(e) => set({ visitDate: e.target.value })} /></Field>
            </div>
          </Section>

          <Section title="Chief complaints" hint="one per line">
            <AutoTextarea value={report.complaints} onChange={(v) => set({ complaints: v })} className={area} aria-label="Chief complaints" placeholder="e.g. Itching (2 weeks)" />
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="History">
              <AutoTextarea value={report.history} onChange={(v) => set({ history: v })} className={area} aria-label="History" />
            </Section>
            <Section title="Examination" hint="findings, vitals">
              <AutoTextarea value={report.examination} onChange={(v) => set({ examination: v })} className={area} aria-label="Examination" />
            </Section>
          </div>

          <Section
            title="Diagnosis"
            action={
              <button type="button" className={ADD_BTN} onClick={() => set({ diagnosis: [...report.diagnosis, { id: createId('d_'), text: '', source: '', flags: [] }] })}>
                <PlusIcon size={14} /> Add
              </button>
            }
          >
            {report.diagnosis.length === 0 && <p className="text-[13px] text-slate-400">No diagnosis was dictated.</p>}
            <div className="space-y-2">
              {report.diagnosis.map((d) => (
                <div key={d.id}>
                  <div className="flex items-center gap-2">
                    <input className={input} value={d.text} onChange={(e) => setDx(d.id, { text: e.target.value })} aria-label="Diagnosis" />
                    <button aria-label="Remove diagnosis" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => set({ diagnosis: report.diagnosis.filter((x) => x.id !== d.id) })}>
                      <XIcon size={15} />
                    </button>
                  </div>
                  <ItemNotes source={d.source} flags={d.flags.map((f) => FLAG_TEXT[f])} />
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Medicines (Rx)"
            action={
              <button type="button" className={ADD_BTN} onClick={() => set({ medicines: [...report.medicines, emptyMedicine()] })} data-testid="add-medicine">
                <PlusIcon size={14} /> Add medicine
              </button>
            }
          >
            {report.medicines.length === 0 && <p className="text-[13px] text-slate-400">No medicines were dictated.</p>}
            <div className="space-y-3">
              {report.medicines.map((m, i) => {
                const dict = dictionaryStatus(matcher, m.name);
                const flagged = m.flags.length > 0 || dict.issues.length > 0;
                return (
                  <div key={m.id} className={`rounded-lg p-3 ring-1 ring-inset ${flagged ? 'bg-amber-50/50 ring-amber-300' : 'bg-slate-50 ring-slate-200'}`} data-testid="medicine">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-slate-500">{i + 1}.</span>
                      <input className={`${input} font-medium`} value={m.name} onChange={(e) => setMed(m.id, { name: e.target.value })} aria-label="Medicine name" placeholder="Medicine" />
                      <input className={`${input} max-w-[8rem]`} value={m.strength} onChange={(e) => setMed(m.id, { strength: e.target.value })} aria-label="Strength" placeholder="Strength" />
                      <button aria-label="Remove medicine" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => set({ medicines: report.medicines.filter((x) => x.id !== m.id) })}>
                        <XIcon size={15} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      <Field label="Dose"><input className={input} value={m.dose} onChange={(e) => setMed(m.id, { dose: e.target.value })} placeholder="1 tablet" /></Field>
                      <Field label="How often"><input className={input} value={m.frequency} onChange={(e) => setMed(m.id, { frequency: e.target.value })} placeholder="twice daily / 1-0-1" /></Field>
                      <Field label="When"><input className={input} value={m.timing} onChange={(e) => setMed(m.id, { timing: e.target.value })} placeholder="after food" /></Field>
                      <Field label="How long"><input className={input} value={m.duration} onChange={(e) => setMed(m.id, { duration: e.target.value })} placeholder="5 days" /></Field>
                      <Field label="Route"><input className={input} value={m.route} onChange={(e) => setMed(m.id, { route: e.target.value })} placeholder="oral" /></Field>
                      <Field label="Instructions" className="col-span-1 md:col-span-3"><input className={input} value={m.instructions} onChange={(e) => setMed(m.id, { instructions: e.target.value })} /></Field>
                    </div>
                    <ItemNotes
                      source={m.source}
                      flags={m.flags.map((f) => FLAG_TEXT[f])}
                      extra={
                        dict.issues.length > 0 ? (
                          <Flag>
                            Not in medicine dictionary. Did you mean{' '}
                            {dict.issues[0].suggestions.map((s, k) => (
                              <button key={s} type="button" className="underline decoration-dotted hover:text-amber-700" onClick={() => setMed(m.id, { name: applyMedicineFix(m.name, dict.issues[0], s) })}>
                                {s}
                                {k < dict.issues[0].suggestions.length - 1 ? ',' : ''}
                              </button>
                            ))}
                            ?
                          </Flag>
                        ) : m.name.trim() && !dict.known ? (
                          <Flag tone="slate">Not in your medicine dictionary</Flag>
                        ) : null
                      }
                    />
                  </div>
                );
              })}
            </div>
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Investigations" hint="one per line">
              <AutoTextarea value={report.investigations} onChange={(v) => set({ investigations: v })} className={area} aria-label="Investigations" />
            </Section>
            <Section title="Advice" hint="one per line">
              <AutoTextarea value={report.advice} onChange={(v) => set({ advice: v })} className={area} aria-label="Advice" />
            </Section>
          </div>

          <Section title="Follow-up">
            <input className={input} value={report.followUp} onChange={(e) => set({ followUp: e.target.value })} placeholder="e.g. After 2 weeks" aria-label="Follow-up" />
          </Section>
          <div className="h-6" />
        </div>
      </div>
      <ReportPrint report={report} clinic={clinic} />
    </div>
  );
}

function ItemNotes({ source, flags, extra }: { source: string; flags: string[]; extra?: ReactNode }) {
  if (!source && !flags.length && !extra) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
      {flags.map((f) => (
        <Flag key={f}>
          <AlertIcon size={12} /> {f}
        </Flag>
      ))}
      {extra}
      {source && (
        <span className="speech-text text-slate-500" title="Words in the dictation this came from">
          Heard: “{source}”
        </span>
      )}
    </div>
  );
}
