import type { MicPermission, RecorderPhase } from '../../hooks/useSpeechRecognition';

interface Props {
  phase: RecorderPhase;
  voiceActive: boolean;
  pending: number;
  interim: string;
  hasFinal: boolean;
  permission: MicPermission;
}

type StepState = 'off' | 'on' | 'done';

function Step({ label, state, hint }: { label: string; state: StepState; hint: string }) {
  return (
    <li className="flex items-center gap-2" title={hint}>
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${
          state === 'on' ? 'bg-blue-600 ring-blue-600' : state === 'done' ? 'bg-emerald-500 ring-emerald-500' : 'bg-white ring-slate-300'
        }`}
      >
        {state === 'on' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
        {state === 'done' && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <span className={`text-[12.5px] ${state === 'off' ? 'text-slate-400' : 'font-medium text-slate-800'}`}>{label}</span>
    </li>
  );
}

/**
 * Shows the four stages separately so the doctor can tell what is happening:
 * audio being captured → audio being processed → text being recognised → final text available.
 */
export function RecordingStatus({ phase, voiceActive, pending, interim, hasFinal, permission }: Props) {
  const capturing: StepState = phase === 'recording' ? 'on' : 'off';
  const processing: StepState = pending > 0 || phase === 'finishing' ? 'on' : 'off';
  const recognising: StepState = interim ? 'on' : 'off';
  const final: StepState = hasFinal && pending === 0 && !interim && phase !== 'finishing' ? 'done' : 'off';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">Status</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
            permission === 'granted'
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : permission === 'denied'
                ? 'bg-red-50 text-red-700 ring-red-200'
                : 'bg-slate-50 text-slate-600 ring-slate-200'
          }`}
          aria-label="Microphone permission"
        >
          Mic: {permission === 'granted' ? 'allowed' : permission === 'denied' ? 'blocked' : permission === 'prompt' ? 'will ask' : 'not yet asked'}
        </span>
      </div>
      <ol className="space-y-1.5" aria-live="polite">
        <Step label={voiceActive && phase === 'recording' ? 'Capturing audio — speech detected' : 'Capturing audio'} state={capturing} hint="The microphone is on and audio is being recorded." />
        <Step label={pending > 1 ? `Processing audio (${pending} parts)` : 'Processing audio'} state={processing} hint="Finished phrases are being sent to the recognition engine." />
        <Step label="Recognising text" state={recognising} hint="Provisional text for what you are saying now (shown in grey)." />
        <Step label="Final transcription available" state={final} hint="All spoken text has been converted." />
      </ol>
    </div>
  );
}
