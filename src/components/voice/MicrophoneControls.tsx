import type { RecorderPhase } from '../../hooks/useSpeechRecognition';
import { Spinner } from '../editor/RecognitionStatus';

interface Props {
  phase: RecorderPhase;
  elapsedMs: number;
  level: number;
  voiceActive: boolean;
  canPause: boolean;
  showLevel: boolean;
  disabled: boolean;
  onStart(): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const MicGlyph = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
    <path d="M12 18v4" />
  </svg>
);

/** Large microphone button + start / pause / resume / stop, timer and input level. */
export function MicrophoneControls(p: Props) {
  const live = p.phase === 'recording' || p.phase === 'paused' || p.phase === 'finishing';
  const recording = p.phase === 'recording';
  const bars = 12;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        {recording && (
          <span
            className="absolute inset-0 rounded-full bg-red-500/20 transition-transform duration-150"
            style={{ transform: `scale(${1.08 + (p.voiceActive ? p.level * 0.35 : 0)})` }}
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          onClick={live ? p.onStop : p.onStart}
          disabled={p.disabled || p.phase === 'starting' || p.phase === 'finishing'}
          aria-label={live ? 'Stop recording' : 'Start recording'}
          className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition-colors focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-blue-400 disabled:opacity-50 ${
            live ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'
          }`}
        >
          {p.phase === 'starting' || p.phase === 'finishing' ? (
            <Spinner className="h-7 w-7 border-[3px]" />
          ) : live ? (
            <span className="block h-8 w-8 rounded-md bg-white" aria-hidden="true" />
          ) : (
            <MicGlyph size={36} />
          )}
        </button>
      </div>

      <div className="text-center">
        <div className="font-mono text-[22px] font-medium tabular-nums text-slate-900" aria-label="Recording duration">
          {formatDuration(p.elapsedMs)}
        </div>
        <div className="text-[12px] text-slate-500">
          {p.phase === 'idle' && 'Tap to start dictating'}
          {p.phase === 'starting' && 'Starting microphone…'}
          {p.phase === 'recording' && (p.voiceActive ? 'Listening — speech detected' : 'Listening')}
          {p.phase === 'paused' && 'Paused — nothing is being recorded'}
          {p.phase === 'finishing' && 'Finishing transcription…'}
        </div>
      </div>

      {p.showLevel && (
        <div className="flex h-5 items-end gap-[3px]" aria-hidden="true">
          {Array.from({ length: bars }, (_, i) => {
            const on = recording && p.level * bars > i;
            return <span key={i} className={`w-1.5 rounded-sm ${on ? 'bg-red-500' : 'bg-slate-200'}`} style={{ height: 6 + (i % 4) * 3 }} />;
          })}
        </div>
      )}

      <div className="flex gap-2">
        {!live ? (
          <button type="button" className="btn-primary" onClick={p.onStart} disabled={p.disabled || p.phase === 'starting'}>
            Start recording
          </button>
        ) : (
          <>
            {p.canPause &&
              (p.phase === 'paused' ? (
                <button type="button" className="btn-secondary" onClick={p.onResume}>
                  Resume
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={p.onPause} disabled={p.phase !== 'recording'}>
                  Pause
                </button>
              ))}
            <button type="button" className="btn-danger" onClick={p.onStop} disabled={p.phase === 'finishing'}>
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
