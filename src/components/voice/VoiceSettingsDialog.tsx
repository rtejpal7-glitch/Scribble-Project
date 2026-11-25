import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SpeechSettings } from '../../recognition/speech/speechSettings';
import { createSpeechProvider } from '../../recognition/speech/speechSettings';
import { SpeechServerClient } from '../../recognition/speech/SpeechServerClient';
import { XIcon } from '../common/icons';
import { Spinner } from '../editor/RecognitionStatus';

interface Props {
  open: boolean;
  settings: SpeechSettings;
  recording: boolean;
  onClose(): void;
  onSave(settings: SpeechSettings): void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

const input =
  'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

export function VoiceSettingsDialog({ open, settings, recording, onClose, onSave }: Props) {
  const [s, setS] = useState(settings);
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>({ state: 'idle' });
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setS(settings);
      setTest({ state: 'idle' });
    }
  }, [open, settings]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const patch = (p: Partial<SpeechSettings>) => setS((x) => ({ ...x, ...p }));
  const runTest = async () => {
    setTest({ state: 'testing' });
    const { provider } = createSpeechProvider({ ...s, engine: 'server' });
    const a = await provider!.checkAvailability();
    let check = '';
    if (a.available) {
      try {
        const h = await new SpeechServerClient(s.serverUrl, s.serverToken).health();
        check = h.suggest?.enabled ? ` · sentence check: ${h.suggest.backend} (${h.suggest.model})` : ' · sentence check: off on server';
      } catch {
        /* ignore */
      }
    }
    setTest({ state: a.available ? 'ok' : 'fail', message: ([a.reason, a.detail].filter(Boolean).join(' — ') || 'Connected.') + check });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/25 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-settings-title"
        className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3.5">
          <h2 id="voice-settings-title" className="flex-1 text-[15px] font-semibold text-slate-900">
            Voice settings
          </h2>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {recording && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200 ring-inset">
              Changes apply to the next recording.
            </p>
          )}
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-slate-800">Recognition engine</legend>
            <div className="space-y-2">
              {(
                [
                  [
                    'server',
                    'Self-hosted Whisper server (recommended)',
                    'Runs on your own computer or clinic server. Audio never goes to a third party. Supports English, Hindi and Hinglish. Needs the speech server running (see README).',
                  ],
                  [
                    'browser',
                    'Browser speech recognition',
                    'No setup and truly live, but audio is sent to Apple (Safari) or Google (Chrome). No Hindi–English code-switching. Not for patient data.',
                  ],
                ] as const
              ).map(([id, title, desc]) => (
                <label
                  key={id}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${s.engine === id ? 'border-blue-500 bg-blue-50/40' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <input type="radio" name="engine" className="mt-1" checked={s.engine === id} onChange={() => patch({ engine: id })} />
                  <span>
                    <span className="block text-[13.5px] font-medium text-slate-900">{title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {s.engine === 'browser' && (
            <label className="flex gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200 ring-inset">
              <input type="checkbox" className="mt-1" checked={s.browserConsent} onChange={(e) => patch({ browserConsent: e.target.checked })} />
              <span className="text-[12.5px] leading-snug text-amber-950">
                I understand that with this engine the browser sends my audio to Apple or Google for recognition, and I will not use it
                for real patient information.
              </span>
            </label>
          )}
          <div className="space-y-3">
              {s.engine === 'browser' && (
                <p className="text-[12.5px] leading-snug text-slate-500">
                  Optional with the browser engine: your speech server is still used for the sentence check.
                </p>
              )}
              <Field label="Speech server URL" hint="Use https:// when this app is opened over https (e.g. from Vercel on an iPad).">
                <input className={input} value={s.serverUrl} onChange={(e) => patch({ serverUrl: e.target.value.trim() })} placeholder="http://localhost:8765" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </Field>
              <Field label="Access token" hint="The SPEECH_SERVER_TOKEN from the server's .env file. Stored only in this browser.">
                <input className={input} type="password" value={s.serverToken} onChange={(e) => patch({ serverToken: e.target.value.trim() })} autoComplete="off" />
              </Field>
              <div className="flex items-center gap-3">
                <button type="button" className="btn-secondary" onClick={runTest} disabled={test.state === 'testing'}>
                  {test.state === 'testing' && <Spinner />} Test connection
                </button>
                {test.state === 'ok' && <span className="text-[12.5px] text-emerald-700">✓ {test.message}</span>}
                {test.state === 'fail' && <span className="text-[12.5px] text-red-700">{test.message}</span>}
              </div>
          </div>

          <div className="space-y-3 border-t border-slate-200 pt-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={s.retainAudio} onChange={(e) => patch({ retainAudio: e.target.checked })} />
              <span>
                <span className="block text-[13.5px] font-medium text-slate-900">Keep audio recordings on this device</span>
                <span className="block text-[12.5px] leading-snug text-slate-500">
                  Off by default: audio is discarded after transcription and only the text is saved. When on, recordings are stored
                  locally (self-hosted engine only) so you can replay or re-transcribe them, and can be deleted at any time.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={s.autoPunctuation} onChange={(e) => patch({ autoPunctuation: e.target.checked })} />
              <span>
                <span className="block text-[13.5px] font-medium text-slate-900">Tidy sentences</span>
                <span className="block text-[12.5px] leading-snug text-slate-500">Capitalise and end each sentence with “.” (or “।” after Hindi).</span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={s.sentenceCheck} onChange={(e) => patch({ sentenceCheck: e.target.checked })} />
              <span>
                <span className="block text-[13.5px] font-medium text-slate-900">Suggest fixes for sentences that don't make sense</span>
                <span className="block text-[12.5px] leading-snug text-slate-500">
                  e.g. “Hi why am Rahul” → “Hi I am Rahul”. Uses a local AI model on your speech server (Ollama, see README), so
                  the text stays on your machine. Needs the server URL and token above, even when you use the browser engine.
                  Suggestions are never applied without your tap.
                </span>
              </span>
            </label>
            <Field label={`New paragraph after a pause of ${s.paragraphPauseSec} s`}>
              <input type="range" min={2} max={15} step={1} value={s.paragraphPauseSec} onChange={(e) => patch({ paragraphPauseSec: Number(e.target.value) })} className="mt-2 w-full" />
            </Field>
            <Field
              label="Medical vocabulary"
              hint="Comma-separated drug names and terms you use often. Sent with each request to improve spelling (self-hosted engine)."
            >
              <textarea
                className={`${input} min-h-[72px]`}
                value={s.vocabulary}
                onChange={(e) => patch({ vocabulary: e.target.value })}
                placeholder="benzoyl peroxide, clobetasol, cetirizine, eczema, psoriasis"
              />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onSave(s);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
