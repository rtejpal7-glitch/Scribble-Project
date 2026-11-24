import type {
  SpeechAvailability,
  SpeechProviderCapabilities,
  SpeechRecognitionProvider,
  SpeechSession,
  SpeechSessionOptions,
} from './SpeechRecognitionProvider';
import { SpeechError, type RecordedAudio, type SpeechLanguage } from '../../types/speech';
import { SpeechServerClient } from './SpeechServerClient';
import { AudioCapture } from './audio/AudioCapture';
import { UtteranceSegmenter, rms } from './audio/UtteranceSegmenter';
import { SPEECH_SAMPLE_RATE, encodeWav, floatToInt16 } from './audio/wav';

const INTERIM_EVERY_MS = 1100;
const MIN_INTERIM_MS = 900;
const RETRY_DELAYS = [600, 2000];
/** Longest recording kept for audio retention (memory on iPad is limited). */
const MAX_RETAINED_MS = 45 * 60 * 1000;

export interface WhisperServerConfig {
  url: string;
  token: string;
}

/**
 * Self-hosted Whisper (speech-server/). Audio goes only to the server you run.
 *
 * Live behaviour ("chunked streaming"): the microphone stream is split into
 * utterances at natural pauses. While an utterance is in progress, a fast
 * low-beam pass produces interim text roughly every second; when the speaker
 * pauses, the full utterance is transcribed once with full accuracy and
 * becomes final. Utterances never overlap, so text is never duplicated or
 * rewritten after it is final.
 */
export class WhisperServerProvider implements SpeechRecognitionProvider {
  readonly id = 'whisper-server';
  readonly displayName = 'Self-hosted Whisper';
  readonly capabilities: SpeechProviderCapabilities = {
    streaming: 'chunked',
    interimResults: true,
    languages: { 'en-IN': 'native', 'hi-IN': 'native', hinglish: 'native' },
    dataLocation: 'Audio is sent only to the speech server you run (your computer or clinic server).',
    thirdParty: false,
    worksOffline: true,
    canRetainAudio: true,
    pauseResume: true,
    levelMeter: true,
    vocabulary: true,
  };

  private client: SpeechServerClient;

  constructor(private readonly config: WhisperServerConfig) {
    this.client = new SpeechServerClient(config.url, config.token);
  }

  async checkAvailability(): Promise<SpeechAvailability> {
    if (!this.config.url) return { available: false, reason: 'No speech server URL set. Open Voice settings.' };
    if (!this.config.token) return { available: false, reason: 'No access token set. Open Voice settings.' };
    try {
      const h = await this.client.health();
      const modes = Object.entries(h.modes);
      const broken = modes.filter(([, m]) => m.error);
      const loading = modes.filter(([, m]) => m.loading);
      const detail = modes.map(([k, m]) => `${k}: ${m.model}${m.loaded ? '' : m.loading ? ' (loading…)' : m.error ? ' (error)' : ''}`).join(' · ');
      if (broken.length) return { available: true, reason: `Model error: ${broken[0][1].error}`, detail };
      if (loading.length) return { available: true, reason: 'Models are still loading on the server; the first request may be slow.', detail };
      return { available: true, detail };
    } catch (e) {
      return { available: false, reason: e instanceof SpeechError ? e.message : String(e) };
    }
  }

  createSession(options: SpeechSessionOptions): SpeechSession {
    return new ServerSession(this.client, options);
  }

  async transcribeClip(clip: Float32Array, language: SpeechLanguage, vocabulary: string): Promise<string> {
    const r = await this.client.transcribe(encodeWav([clip]), language, { vocabulary });
    return r.text;
  }
}

interface QueuedUtterance {
  audio: Float32Array;
  startMs: number;
  endMs: number;
}

class ServerSession implements SpeechSession {
  private capture: AudioCapture;
  private segmenter = new UtteranceSegmenter();
  private samples = 0;
  private retained: Int16Array[] = [];
  private retainedSamples = 0;
  private queue: QueuedUtterance[] = [];
  private working = false;
  private drained: (() => void) | null = null;
  private interimTimer: ReturnType<typeof setInterval> | null = null;
  private interimInFlight = false;
  private interimAbort: AbortController | null = null;
  private paused = false;
  private stopped = false;
  private levelTick = 0;

  constructor(
    private readonly client: SpeechServerClient,
    private readonly options: SpeechSessionOptions,
  ) {
    this.capture = new AudioCapture((frame) => this.onFrame(frame));
  }

  private emit: SpeechSessionOptions['onEvent'] = (e) => {
    if (!this.stopped || e.type === 'final' || e.type === 'failed' || e.type === 'pending') this.options.onEvent(e);
  };

  private get timeMs() {
    return (this.samples / SPEECH_SAMPLE_RATE) * 1000;
  }

  async start(): Promise<void> {
    await this.capture.start();
    this.interimTimer = setInterval(() => void this.interim(), INTERIM_EVERY_MS);
  }

  private onFrame(frame: Float32Array) {
    if (this.paused || this.stopped) return;
    const t = this.timeMs;
    this.samples += frame.length;
    if (this.options.retainAudio && this.timeMs <= MAX_RETAINED_MS) {
      this.retained.push(floatToInt16(frame));
      this.retainedSamples += frame.length;
    }
    if (++this.levelTick % 3 === 0) this.emit({ type: 'level', level: Math.min(1, rms(frame) * 6) });
    for (const ev of this.segmenter.push(frame, t)) this.handleSegment(ev);
  }

  private handleSegment(ev: ReturnType<UtteranceSegmenter['push']>[number]) {
    if (ev.type === 'start') this.emit({ type: 'activity', voice: true });
    else if (ev.type === 'discard') this.emit({ type: 'activity', voice: false });
    else {
      this.emit({ type: 'activity', voice: false });
      this.interimAbort?.abort();
      this.queue.push({ audio: ev.audio, startMs: ev.startMs, endMs: ev.endMs });
      this.emit({ type: 'pending', count: this.queue.length + (this.working ? 1 : 0) });
      void this.work();
    }
  }

  private async interim() {
    if (this.paused || this.stopped || this.interimInFlight || this.working || this.queue.length) return;
    if (!this.segmenter.inSpeech || this.segmenter.currentDurationMs() < MIN_INTERIM_MS) return;
    const audio = this.segmenter.current();
    if (!audio) return;
    const id = this.segmenter.utteranceId;
    this.interimInFlight = true;
    this.interimAbort = new AbortController();
    try {
      const r = await this.client.transcribe(encodeWav([audio]), this.options.language, {
        interim: true,
        vocabulary: this.options.vocabulary,
        signal: this.interimAbort.signal,
      });
      if (this.segmenter.inSpeech && this.segmenter.utteranceId === id && r.text) this.emit({ type: 'interim', text: r.text });
    } catch (e) {
      if (e instanceof SpeechError && e.kind === 'auth') this.fatal(e);
      // Other interim failures are harmless: the final pass will run anyway.
    } finally {
      this.interimInFlight = false;
    }
  }

  private async work() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        this.emit({ type: 'pending', count: this.queue.length + 1 });
        await this.transcribeFinal(item);
      }
    } finally {
      this.working = false;
      this.emit({ type: 'pending', count: this.queue.length });
      if (!this.queue.length) this.drained?.();
    }
  }

  private async transcribeFinal(item: QueuedUtterance) {
    const wav = encodeWav([item.audio]);
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.client.transcribe(wav, this.options.language, { vocabulary: this.options.vocabulary });
        this.emit({ type: 'final', text: r.text, startMs: item.startMs, endMs: item.endMs });
        return;
      } catch (e) {
        const err = e instanceof SpeechError ? e : new SpeechError('unknown', String(e));
        if (err.kind === 'auth') {
          this.emit({ type: 'failed', error: err.message, startMs: item.startMs, endMs: item.endMs, clip: item.audio });
          this.fatal(err);
          return;
        }
        const transient = err.kind === 'network' || err.kind === 'server';
        if (transient && attempt < RETRY_DELAYS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        this.emit({ type: 'failed', error: err.message, startMs: item.startMs, endMs: item.endMs, clip: item.audio });
        return;
      }
    }
  }

  private fatal(error: SpeechError) {
    if (this.stopped) return;
    this.options.onEvent({ type: 'error', error });
    this.abort();
  }

  pause() {
    if (this.paused || this.stopped) return;
    for (const ev of this.segmenter.flush(this.timeMs)) this.handleSegment(ev);
    this.paused = true;
    this.capture.pause();
  }

  resume() {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    this.capture.resume();
  }

  async stop(): Promise<RecordedAudio | null> {
    if (this.stopped) return null;
    if (!this.paused) for (const ev of this.segmenter.flush(this.timeMs)) this.handleSegment(ev);
    this.stopped = true;
    if (this.interimTimer) clearInterval(this.interimTimer);
    this.interimAbort?.abort();
    await this.capture.stop(); // microphone released here
    if (this.working || this.queue.length) {
      await new Promise<void>((resolve) => (this.drained = resolve));
    }
    if (!this.options.retainAudio || !this.retainedSamples) return null;
    const wav = encodeWav(this.retained);
    this.retained = [];
    return { wav, durationMs: (this.retainedSamples / SPEECH_SAMPLE_RATE) * 1000 };
  }

  abort() {
    this.stopped = true;
    this.queue = [];
    this.retained = [];
    if (this.interimTimer) clearInterval(this.interimTimer);
    this.interimAbort?.abort();
    void this.capture.stop();
    this.drained?.();
  }
}
