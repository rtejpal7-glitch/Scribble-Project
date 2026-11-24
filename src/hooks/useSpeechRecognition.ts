import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import type { SpeechAvailability, SpeechRecognitionProvider, SpeechSession } from '../recognition/speech/SpeechRecognitionProvider';
import type { SpeechSettings } from '../recognition/speech/speechSettings';
import type { VoiceStorageAdapter } from '../storage/VoiceStorage';
import type { VoiceAction, VoiceState } from '../state/voiceReducer';
import { SpeechError, type SpeechEvent } from '../types/speech';
import { cleanText, dedupeFinal, punctuate } from '../recognition/speech/postprocess';
import { decodeWav, SPEECH_SAMPLE_RATE } from '../recognition/speech/audio/wav';
import { createId } from '../utils/id';

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing';
export type MicPermission = 'unknown' | 'prompt' | 'granted' | 'denied';

interface Options {
  provider: SpeechRecognitionProvider | null;
  providerReason?: string;
  settings: SpeechSettings;
  storage: VoiceStorageAdapter;
  stateRef: MutableRefObject<VoiceState>;
  dispatch: Dispatch<VoiceAction>;
}

/**
 * Runs one recording at a time and turns engine events into transcript
 * segments: interim text is shown separately, finals are cleaned, de-duplicated,
 * punctuated and appended (never rewritten), failed utterances keep their audio
 * in memory for "Retry".
 */
export function useSpeechRecognition({ provider, providerReason, settings, storage, stateRef, dispatch }: Options) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);
  const [pending, setPending] = useState(0);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [availability, setAvailability] = useState<SpeechAvailability | null>(null);
  const [checking, setChecking] = useState(false);

  const session = useRef<SpeechSession | null>(null);
  const recordingId = useRef<string | null>(null);
  const clock = useRef({ startedAt: 0, accumulated: 0, running: false });
  const last = useRef<{ text: string | null; endMs: number | null; first: boolean }>({ text: null, endMs: null, first: true });
  const pendingParagraph = useRef(false);
  const clips = useRef(new Map<string, Float32Array>());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ------------------------------- availability ------------------------------ */
  const refreshAvailability = useCallback(async () => {
    if (!provider) {
      setAvailability({ available: false, reason: providerReason ?? 'No speech engine selected.' });
      return;
    }
    setChecking(true);
    try {
      setAvailability(await provider.checkAvailability());
    } finally {
      setChecking(false);
    }
  }, [provider, providerReason]);

  useEffect(() => {
    void refreshAvailability();
  }, [refreshAvailability]);

  useEffect(() => {
    let status: PermissionStatus | null = null;
    const nav = navigator as Navigator & { permissions?: Permissions };
    nav.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((s) => {
        status = s;
        const map = () => setPermission(s.state === 'granted' ? 'granted' : s.state === 'denied' ? 'denied' : 'prompt');
        map();
        s.onchange = map;
      })
      .catch(() => undefined); // Safari: not queryable; we learn on first use
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  /* ---------------------------------- clock --------------------------------- */
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => {
      const c = clock.current;
      setElapsedMs(c.accumulated + (c.running ? performance.now() - c.startedAt : 0));
    }, 250);
    return () => clearInterval(t);
  }, [phase]);

  const clockStart = () => {
    clock.current.startedAt = performance.now();
    clock.current.running = true;
  };
  const clockStop = () => {
    const c = clock.current;
    if (c.running) c.accumulated += performance.now() - c.startedAt;
    c.running = false;
    setElapsedMs(c.accumulated);
  };

  /* ---------------------------------- events -------------------------------- */
  const finishRecording = useCallback(
    async (audio: { wav: Blob; durationMs: number } | null) => {
      const id = recordingId.current;
      recordingId.current = null;
      clockStop();
      const doc = stateRef.current.doc;
      let audioStored = false;
      if (id && doc && audio) {
        try {
          await storage.saveAudio(id, doc.id, audio.wav);
          audioStored = true;
        } catch {
          setError('The recording could not be saved on this device (storage full?). The transcript is kept.');
        }
      }
      if (id) dispatch({ type: 'recordingFinished', recordingId: id, durationMs: clock.current.accumulated, audioStored });
    },
    [dispatch, stateRef, storage],
  );

  const onEvent = useCallback(
    (e: SpeechEvent) => {
      const doc = stateRef.current.doc;
      if (!doc) return;
      switch (e.type) {
        case 'interim':
          setInterim(cleanText(e.text));
          return;
        case 'activity':
          setVoiceActive(e.voice);
          return;
        case 'level':
          setLevel(e.level);
          return;
        case 'pending':
          setPending(e.count);
          return;
        case 'final': {
          setInterim('');
          // Only engines that stream natively can repeat or accumulate results; chunked engines
          // transcribe each utterance once, so a repeated sentence there is really spoken twice.
          const fresh =
            provider?.capabilities.streaming === 'native' ? dedupeFinal(last.current.text, e.text) : cleanText(e.text) || null;
          if (!fresh) return;
          const s = settingsRef.current;
          const text = s.autoPunctuation ? punctuate(fresh) : fresh;
          const gap =
            last.current.endMs !== null && e.startMs !== null ? e.startMs - last.current.endMs : 0;
          const paragraphStart = last.current.first || pendingParagraph.current || gap > s.paragraphPauseSec * 1000;
          pendingParagraph.current = false;
          last.current = { text: fresh, endMs: e.endMs, first: false };
          dispatch({
            type: 'appendSegment',
            segment: {
              recordingId: recordingId.current,
              text,
              source: 'speech',
              status: 'final',
              startMs: e.startMs,
              endMs: e.endMs,
              language: doc.language,
              engine: provider?.id ?? 'unknown',
              paragraphStart,
            },
          });
          return;
        }
        case 'failed': {
          setInterim('');
          const id = createId('t_');
          if (e.clip) clips.current.set(id, e.clip);
          const paragraphStart = last.current.first || pendingParagraph.current;
          pendingParagraph.current = false;
          last.current = { ...last.current, endMs: e.endMs, first: false };
          dispatch({
            type: 'appendSegment',
            segment: {
              id,
              recordingId: recordingId.current,
              text: '',
              source: 'speech',
              status: 'failed',
              error: e.error,
              startMs: e.startMs,
              endMs: e.endMs,
              language: doc.language,
              engine: provider?.id ?? 'unknown',
              paragraphStart,
            },
          });
          return;
        }
        case 'error': {
          setError(e.error.message);
          if (e.error.kind === 'permission') setPermission('denied');
          setInterim('');
          setVoiceActive(false);
          session.current = null;
          setPhase('idle');
          void finishRecording(null);
          return;
        }
      }
    },
    [dispatch, finishRecording, provider, stateRef],
  );

  /* --------------------------------- controls -------------------------------- */
  const start = useCallback(async () => {
    const doc = stateRef.current.doc;
    if (!doc || session.current) return;
    setError(null);
    if (!provider) {
      setError(providerReason ?? 'No speech engine selected.');
      return;
    }
    const s = settingsRef.current;
    const retain = s.retainAudio && provider.capabilities.canRetainAudio;
    const sess = provider.createSession({ language: doc.language, vocabulary: s.vocabulary, retainAudio: retain, onEvent });
    session.current = sess;
    const id = createId('r_');
    recordingId.current = id;
    last.current = { text: null, endMs: null, first: true };
    clock.current = { startedAt: 0, accumulated: 0, running: false };
    setElapsedMs(0);
    setPhase('starting');
    try {
      await sess.start(); // permission prompt happens here (inside the tap on iPad)
      setPermission('granted');
      dispatch({
        type: 'recordingStarted',
        recording: { id, startedAt: Date.now(), durationMs: 0, language: doc.language, engine: provider.id, audioStored: false },
      });
      clockStart();
      setPhase('recording');
    } catch (err) {
      const e = err instanceof SpeechError ? err : new SpeechError('unknown', String(err));
      if (e.kind === 'permission') setPermission('denied');
      setError(e.message);
      sess.abort();
      session.current = null;
      recordingId.current = null;
      setPhase('idle');
    }
  }, [dispatch, onEvent, provider, providerReason, stateRef]);

  const pause = useCallback(() => {
    if (!session.current || phase !== 'recording') return;
    session.current.pause();
    clockStop();
    setVoiceActive(false);
    setLevel(0);
    setPhase('paused');
  }, [phase]);

  const resume = useCallback(() => {
    if (!session.current || phase !== 'paused') return;
    session.current.resume();
    clockStart();
    setPhase('recording');
  }, [phase]);

  const stop = useCallback(async () => {
    const sess = session.current;
    if (!sess) return;
    setPhase('finishing');
    clockStop();
    setVoiceActive(false);
    setLevel(0);
    const audio = await sess.stop().catch(() => null);
    session.current = null;
    setInterim('');
    await finishRecording(audio);
    setPhase('idle');
  }, [finishRecording]);

  const newParagraph = useCallback(() => {
    pendingParagraph.current = true;
  }, []);

  /** Re-transcribes a failed utterance (from memory, or from the stored recording). */
  const retrySegment = useCallback(
    async (segmentId: string) => {
      const doc = stateRef.current.doc;
      const seg = doc?.segments.find((s) => s.id === segmentId);
      if (!doc || !seg) return;
      if (!provider?.transcribeClip) {
        dispatch({ type: 'retryFailed', segmentId, error: 'This engine cannot re-transcribe audio. Dictate the sentence again.' });
        return;
      }
      let clip = clips.current.get(segmentId) ?? null;
      if (!clip && seg.recordingId && seg.startMs !== null && seg.endMs !== null) {
        const rec = doc.recordings.find((r) => r.id === seg.recordingId);
        if (rec?.audioStored) {
          const wav = await storage.loadAudio(rec.id).catch(() => null);
          if (wav) {
            const { samples } = await decodeWav(wav);
            clip = samples.slice(Math.floor((seg.startMs / 1000) * SPEECH_SAMPLE_RATE), Math.ceil((seg.endMs / 1000) * SPEECH_SAMPLE_RATE));
          }
        }
      }
      if (!clip) {
        dispatch({ type: 'retryFailed', segmentId, error: 'The audio for this part is no longer available. Dictate it again.' });
        return;
      }
      try {
        const raw = await provider.transcribeClip(clip, seg.language, settingsRef.current.vocabulary);
        const text = settingsRef.current.autoPunctuation ? punctuate(raw) : cleanText(raw);
        if (!text) throw new SpeechError('unknown', 'No speech recognised in this part.');
        clips.current.delete(segmentId);
        dispatch({ type: 'retrySucceeded', segmentId, text });
      } catch (err) {
        dispatch({ type: 'retryFailed', segmentId, error: err instanceof Error ? err.message : String(err) });
      }
    },
    [dispatch, provider, stateRef, storage],
  );

  // Never keep recording in the background if the editor goes away.
  useEffect(
    () => () => {
      session.current?.abort();
      session.current = null;
    },
    [],
  );

  return {
    phase,
    elapsedMs,
    level,
    voiceActive,
    pending,
    interim,
    error,
    setError,
    permission,
    availability,
    checking,
    refreshAvailability,
    start,
    pause,
    resume,
    stop,
    newParagraph,
    retrySegment,
  };
}
