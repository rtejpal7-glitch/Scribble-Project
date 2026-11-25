import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { VoiceAction } from '../state/voiceReducer';
import type { VoiceDocument } from '../types/speech';
import { SpeechError } from '../types/speech';
import { SpeechServerClient } from '../recognition/speech/SpeechServerClient';
import type { SpeechSettings } from '../recognition/speech/speechSettings';
import { medicineStore } from '../clinical/medicineStore';

export type SentenceCheckStatus = 'off' | 'idle' | 'checking' | 'unavailable' | 'error';

const DEBOUNCE_MS = 1400;
const BATCH = 12;

/**
 * Background sentence check: shortly after new sentences are recognised, sends
 * them (with a little preceding context) to the speech server's local language
 * model and stores any proposed correction on the segment. Only recognised,
 * unedited sentences are checked; the user's own writing is left alone.
 */
export function useSentenceCheck(doc: VoiceDocument | null, dispatch: Dispatch<VoiceAction>, settings: SpeechSettings, busy: boolean) {
  const [status, setStatus] = useState<SentenceCheckStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(new Set<string>());
  const blocked = useRef(false); // server said "not configured": wait for a manual retry / settings change
  const docRef = useRef(doc);
  docRef.current = doc;

  const configured = settings.sentenceCheck && !!settings.serverUrl && !!settings.serverToken;

  useEffect(() => {
    blocked.current = false;
    setStatus(configured ? 'idle' : 'off');
    setMessage(
      !settings.sentenceCheck
        ? 'Sentence check is turned off in Voice settings.'
        : !settings.serverUrl || !settings.serverToken
          ? 'Sentence check needs the self-hosted speech server (URL and token in Voice settings).'
          : null,
    );
  }, [configured, settings.sentenceCheck, settings.serverUrl, settings.serverToken]);

  const run = useCallback(
    async (force = false) => {
      const d = docRef.current;
      if (!d || !configured || (blocked.current && !force)) return;
      const segs = d.segments;
      const pending = segs.filter(
        (s) =>
          s.source === 'speech' &&
          s.status === 'final' &&
          !s.edited &&
          s.text.trim().length > 2 &&
          !inFlight.current.has(s.id) &&
          (!s.review || s.review.forText !== s.text),
      );
      if (!pending.length) {
        if (force) setStatus('idle');
        return;
      }
      blocked.current = false;
      const batch = pending.slice(0, BATCH);
      const firstIndex = segs.findIndex((s) => s.id === batch[0].id);
      const context = segs
        .slice(Math.max(0, firstIndex - 4), firstIndex)
        .map((s) => s.text)
        .filter(Boolean);
      batch.forEach((s) => inFlight.current.add(s.id));
      setStatus('checking');
      try {
        const client = new SpeechServerClient(settings.serverUrl, settings.serverToken, 45000);
        const result = await client.suggest(
          d.language,
          batch.map((s) => ({ id: s.id, text: s.text })),
          { context, medicines: medicineStore.get().custom.slice(0, 200) },
        );
        const byId = new Map(result.map((r) => [r.id, r]));
        dispatch({
          type: 'setReviews',
          reviews: batch.map((s) => ({
            segmentId: s.id,
            forText: s.text,
            suggestion: byId.get(s.id)?.text ?? null,
            reason: byId.get(s.id)?.reason,
          })),
        });
        setStatus('idle');
        setMessage(null);
        if (pending.length > batch.length) timer.current = setTimeout(() => void run(), 200);
      } catch (e) {
        const err = e instanceof SpeechError ? e : new SpeechError('unknown', String(e));
        if (err.kind === 'not-configured' || err.kind === 'auth') {
          blocked.current = true;
          setStatus('unavailable');
        } else {
          setStatus('error');
        }
        setMessage(err.message);
      } finally {
        batch.forEach((s) => inFlight.current.delete(s.id));
      }
    },
    [configured, dispatch, settings.serverUrl, settings.serverToken],
  );

  // Re-check shortly after the transcript changes (new finals arrive).
  useEffect(() => {
    if (!configured || busy) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [doc?.segments, configured, busy, run]);

  return { status, message, checkNow: () => void run(true) };
}
