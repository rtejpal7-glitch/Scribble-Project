import { useMemo, useState } from 'react';
import type { EvaluationResult, VoiceDocument } from '../../types/speech';
import { SPEECH_LANGUAGES } from '../../types/speech';
import { score, scriptMismatch } from '../../recognition/speech/evaluation';
import { transcriptText } from '../../state/voiceText';
import { createId } from '../../utils/id';
import { downloadBlob, safeFileName } from '../../utils/exportUtils';
import { ChevronDownIcon, TrashIcon } from '../common/icons';

interface Props {
  doc: VoiceDocument;
  engine: string;
  onSave(result: EvaluationResult): void;
  onDelete(id: string): void;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * "Test accuracy": paste what was actually said, compare it with the
 * transcript (word / character error rate), save results per engine and
 * language, and export them as CSV. Lets you judge engines on your own
 * real-world samples instead of a few demo sentences.
 */
export function EvaluationPanel({ doc, engine, onSave, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>('all');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const hypothesis = useMemo(() => {
    const segs = scope === 'all' ? doc.segments : doc.segments.filter((s) => s.recordingId === scope);
    return transcriptText(segs.filter((s) => s.source === 'speech'), true);
  }, [doc.segments, scope]);
  const result = useMemo(() => (reference.trim() ? score(reference, hypothesis) : null), [reference, hypothesis]);
  const mismatch = result && scriptMismatch(reference, hypothesis);

  const exportCsv = () => {
    const rows = [
      ['date', 'language', 'engine', 'wer', 'cer', 'reference_words', 'note', 'reference', 'hypothesis'],
      ...doc.evaluations.map((e) => [new Date(e.createdAt).toISOString(), e.language, e.engine, e.wer.toFixed(4), e.cer.toFixed(4), e.referenceWords, e.note, e.reference, e.hypothesis]),
    ];
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n'); // BOM: Excel reads Hindi correctly
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeFileName(doc.title)} - accuracy.csv`);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left" aria-expanded={open}>
        <ChevronDownIcon size={15} className={open ? '' : '-rotate-90'} />
        <span className="flex-1 text-[13px] font-semibold text-slate-800">Test accuracy</span>
        {doc.evaluations.length > 0 && <span className="text-[11.5px] text-slate-500">{doc.evaluations.length} saved</span>}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-200 px-3 py-3">
          <p className="text-[12px] leading-snug text-slate-500">
            Dictate a sample, then type exactly what was said. The score compares it with the recognised text (before your edits).
            Use the same script as the output: Roman for Hinglish, Devanagari for Hindi.
          </p>
          <label className="block text-[12.5px] font-medium text-slate-700">
            Compare against
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]">
              <option value="all">Whole transcript</option>
              {[...doc.recordings].reverse().map((r) => (
                <option key={r.id} value={r.id}>
                  Recording {new Date(r.startedAt).toLocaleTimeString()} ({SPEECH_LANGUAGES.find((l) => l.id === r.language)?.short})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12.5px] font-medium text-slate-700">
            What was actually said
            <textarea
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="speech-text mt-1 block min-h-[84px] w-full rounded-lg border border-slate-300 px-2.5 py-2 text-[13.5px] outline-none focus:border-blue-500"
              placeholder="Patient ko do hafte se itching ho rahi hai aur redness bhi hai."
            />
          </label>
          {result && (
            <div className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200 ring-inset">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <span>
                  WER <b className="tabular-nums">{pct(result.wer)}</b>
                </span>
                <span>
                  CER <b className="tabular-nums">{pct(result.cer)}</b>
                </span>
                <span className="text-slate-500">
                  {result.referenceWords} words · {result.substitutions} wrong · {result.deletions} missed · {result.insertions} extra
                </span>
              </div>
              {mismatch && (
                <p className="mt-1.5 text-[12px] text-amber-800">
                  The reference and the transcript are in different scripts (Devanagari vs Roman), so the score is not meaningful.
                </p>
              )}
              <p className="speech-text mt-2 text-[13px] leading-relaxed" aria-label="Word differences">
                {result.ops.map((o, i) =>
                  o.op === 'ok' ? (
                    <span key={i}>{o.ref} </span>
                  ) : o.op === 'sub' ? (
                    <span key={i}>
                      <del className="text-red-600">{o.ref}</del> <ins className="text-emerald-700 no-underline">{o.hyp}</ins>{' '}
                    </span>
                  ) : o.op === 'del' ? (
                    <del key={i} className="mr-1 text-red-600">
                      {o.ref}
                    </del>
                  ) : (
                    <ins key={i} className="mr-1 text-blue-700 no-underline">
                      +{o.hyp}
                    </ins>
                  ),
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (e.g. noisy OPD, fast speech)"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-[12.5px]"
                />
                <button
                  type="button"
                  className="btn-secondary h-8 px-3 text-[12.5px]"
                  onClick={() => {
                    onSave({
                      id: createId('e_'),
                      createdAt: Date.now(),
                      language: doc.language,
                      engine,
                      reference,
                      hypothesis,
                      wer: result.wer,
                      cer: result.cer,
                      referenceWords: result.referenceWords,
                      note,
                    });
                    setNote('');
                    setReference('');
                  }}
                >
                  Save result
                </button>
              </div>
            </div>
          )}
          {doc.evaluations.length > 0 && (
            <div>
              <div className="mb-1 flex items-center">
                <span className="flex-1 text-[12px] font-semibold text-slate-600">Saved results</span>
                <button className="text-[12px] text-blue-700 hover:underline" onClick={exportCsv}>
                  Export CSV
                </button>
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {doc.evaluations.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-[12px]">
                    <span className="tabular-nums">WER {pct(e.wer)}</span>
                    <span className="text-slate-500">{SPEECH_LANGUAGES.find((l) => l.id === e.language)?.short}</span>
                    <span className="truncate text-slate-400">{e.note || e.engine}</span>
                    <span className="flex-1" />
                    <button aria-label="Delete result" className="text-slate-400 hover:text-red-600" onClick={() => onDelete(e.id)}>
                      <TrashIcon size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
