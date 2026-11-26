import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject } from 'react';
import type { VoiceAction, VoiceState } from '../state/voiceReducer';
import type { SpeechSettings } from '../recognition/speech/speechSettings';
import { SpeechServerClient } from '../recognition/speech/SpeechServerClient';
import { SpeechError } from '../types/speech';
import { transcriptText } from '../state/voiceText';
import { reportFromServer, textHash } from '../clinical/report';
import { medicineStore } from '../clinical/medicineStore';

export type ReportGenStatus = 'idle' | 'generating' | 'error';

export interface ReportGenerator {
  status: ReportGenStatus;
  message: string | null;
  elapsedMs: number;
  /** Why reports can't be generated with the current settings (null = they can). */
  unavailableReason: string | null;
  generate(): Promise<void>;
  cancel(): void;
  clearMessage(): void;
}

/**
 * Drafts a consultation report from the transcript on the self-hosted speech
 * server's local language model. Lives in the editor (not the report panel)
 * so a draft keeps generating while the doctor looks at the transcript.
 */
export function useReportGenerator(
  stateRef: RefObject<VoiceState>,
  dispatch: Dispatch<VoiceAction>,
  settings: SpeechSettings,
): ReportGenerator {
  const [status, setStatus] = useState<ReportGenStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);

  // Works with either recognition engine: only the server address and token are needed.
  const unavailableReason =
    !settings.serverUrl.trim() || !settings.serverToken.trim()
      ? 'Reports are written by the local language model on your self-hosted speech server. Enter its address and access token in voice settings.'
      : null;

  useEffect(() => {
    if (status !== 'generating') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [status]);
  useEffect(() => () => abort.current?.abort(), []);

  const generate = useCallback(async () => {
    const doc = stateRef.current?.doc;
    if (!doc || unavailableReason) return;
    const text = transcriptText(doc.segments.filter((s) => s.status === 'final'));
    if (!text.trim()) {
      setStatus('error');
      setMessage('The transcript is empty. Dictate the consultation first.');
      return;
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStatus('generating');
    setMessage(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      const client = new SpeechServerClient(settings.serverUrl, settings.serverToken);
      const res = await client.report(doc.language, text, { medicines: medicineStore.get().custom.slice(0, 300), signal: ctrl.signal });
      const latest = stateRef.current?.doc;
      if (!latest || latest.id !== doc.id) return;
      dispatch({ type: 'setReport', report: reportFromServer(res.report, { model: res.model, transcriptHash: textHash(text) }, latest.report) });
      setStatus('idle');
    } catch (e) {
      if (e instanceof SpeechError && e.kind === 'aborted') {
        setStatus('idle');
        return;
      }
      setStatus('error');
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === ctrl) abort.current = null;
    }
  }, [dispatch, settings.serverToken, settings.serverUrl, stateRef, unavailableReason]);

  return {
    status,
    message,
    elapsedMs: status === 'generating' && startedAt ? now - startedAt : 0,
    unavailableReason,
    generate,
    cancel: () => abort.current?.abort(),
    clearMessage: () => {
      setMessage(null);
      if (status === 'error') setStatus('idle');
    },
  };
}
