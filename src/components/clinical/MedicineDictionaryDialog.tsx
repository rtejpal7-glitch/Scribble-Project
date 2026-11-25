import { useEffect, useState } from 'react';
import { medicineStore, parseMedicineList, useMedicineMatcher, useMedicineSettings } from '../../clinical/medicineStore';
import { applyMedicineFix } from '../../clinical/medicineMatcher';
import { XIcon } from '../common/icons';
import { PillIcon } from './MedicineSuggestions';

interface Props {
  open: boolean;
  onClose(): void;
}

/** Manage the medicine dictionary used to check voice and handwriting text. */
export function MedicineDictionaryDialog({ open, onClose }: Props) {
  const settings = useMedicineSettings();
  const matcher = useMedicineMatcher();
  const [draft, setDraft] = useState('');
  const [trial, setTrial] = useState('Apply clobetasole cream and take cetrizine at night');
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(settings.custom.join('\n'));
      setSavedNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const issues = matcher.check(trial);
  const save = () => {
    const names = parseMedicineList(draft);
    medicineStore.setCustomMedicines(names);
    setDraft(names.join('\n'));
    setSavedNote(`Saved ${names.length} name${names.length === 1 ? '' : 's'}.`);
  };
  const importFile = async (file: File) => {
    const text = await file.text();
    const names = parseMedicineList(text);
    setDraft((d) => parseMedicineList(`${d}\n${names.join('\n')}`).join('\n'));
    setSavedNote(`Imported ${names.length} names from ${file.name}. Press Save to keep them.`);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-900/25 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="med-title" className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3.5">
          <PillIcon size={17} />
          <h2 id="med-title" className="flex-1 text-[15px] font-semibold text-slate-900">
            Medicine dictionary
          </h2>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-[13px]">
          <p className="leading-relaxed text-slate-600">
            After speech or handwriting is converted, words that look like a misspelled medicine are underlined with the likely
            spelling. Nothing changes until you tap a suggestion, because many drug names sound alike. Works for both Voice
            and Handwriting, with any recognition engine.
          </p>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-0.5" checked={settings.useBuiltIn} onChange={(e) => medicineStore.setUseBuiltIn(e.target.checked)} />
            <span>
              <span className="block font-medium text-slate-900">Include the built-in list ({medicineStore.builtInCount} common generic names)</span>
              <span className="block text-slate-500">Generic names often prescribed in India. Not a drug database: no doses.</span>
            </span>
          </label>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="flex-1 font-medium text-slate-900">Your medicines and brands</span>
              <label className="cursor-pointer text-[12.5px] font-medium text-blue-700 hover:underline">
                Import .txt / .csv
                <input type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
              </label>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={'One per line, or separated by commas\nAugmentin\nDolo\nTenovate'}
              className="block min-h-[140px] w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-blue-500"
              aria-label="Your medicines"
            />
            <div className="mt-1.5 flex items-center gap-3">
              <button className="btn-primary h-8 px-3 text-[12.5px]" onClick={save}>
                Save list
              </button>
              <span className="text-[12px] text-slate-500">
                {savedNote ?? `${matcher.size} names active`}
              </span>
            </div>
          </div>
          {settings.allowed.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200 ring-inset">
              <div className="flex items-center">
                <span className="flex-1 text-[12.5px] text-slate-600">
                  Marked “not a medicine”: {settings.allowed.slice(0, 12).join(', ')}
                  {settings.allowed.length > 12 ? '…' : ''}
                </span>
                <button className="text-[12px] text-blue-700 hover:underline" onClick={() => medicineStore.clearAllowed()}>
                  Reset
                </button>
              </div>
            </div>
          )}
          <div className="border-t border-slate-200 pt-3">
            <label className="block font-medium text-slate-900">
              Try it
              <input value={trial} onChange={(e) => setTrial(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-blue-500" />
            </label>
            <ul className="mt-2 space-y-1 text-[12.5px]" data-testid="medicine-trial">
              {issues.length === 0 && <li className="text-slate-500">No medicine spelling issues found.</li>}
              {issues.map((i) => (
                <li key={i.start} className="text-slate-700">
                  “{i.found}” → {i.suggestions.join(', ')}
                  <button className="ml-2 text-blue-700 hover:underline" onClick={() => setTrial(applyMedicineFix(trial, i, i.suggestions[0]))}>
                    apply
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[12px] leading-snug text-slate-500">
            Tip: for voice, also put your ~50 most-used names in Voice settings → Medical vocabulary. That helps the recogniser
            hear them correctly in the first place; this dictionary catches what still comes out wrong.
          </p>
        </div>
      </div>
    </div>
  );
}
