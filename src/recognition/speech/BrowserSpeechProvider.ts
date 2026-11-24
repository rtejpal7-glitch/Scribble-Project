import type {
  SpeechAvailability,
  SpeechProviderCapabilities,
  SpeechRecognitionProvider,
  SpeechSession,
  SpeechSessionOptions,
} from './SpeechRecognitionProvider';
import { SpeechError, type RecordedAudio } from '../../types/speech';

/* Minimal typings for the (prefixed) Web Speech API. */
interface WSRAlternative {
  transcript: string;
}
interface WSRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: WSRAlternative;
}
interface WSREvent extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: WSRResult };
}
interface WSRErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}
interface WSR extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: WSREvent) => void) | null;
  onerror: ((e: WSRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type WSRCtor = new () => WSR;

function getCtor(): WSRCtor | null {
  const w = window as unknown as { SpeechRecognition?: WSRCtor; webkitSpeechRecognition?: WSRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome|CriOS|Chromium|Edg\//.test(ua);
}

/**
 * The browser's built-in speech recognition (Web Speech API).
 *
 * - Safari (iPad / Mac): Apple's speech service. Safari asks the user for
 *   permission to send audio to Apple.
 * - Chrome / Edge: Google's speech service.
 *
 * It streams words as you speak and needs no setup, but audio leaves the
 * device to a third party, and it cannot handle Hindi–English code-switching:
 * "Hinglish" is run with the Hindi (India) recogniser and is marked approximate.
 * Requires explicit opt-in in Voice settings.
 */
export class BrowserSpeechProvider implements SpeechRecognitionProvider {
  readonly id = 'browser';
  readonly displayName: string;
  readonly capabilities: SpeechProviderCapabilities;

  constructor() {
    const vendor = isSafari() ? 'Apple' : 'Google';
    this.displayName = `Browser speech (${vendor})`;
    this.capabilities = {
      streaming: 'native',
      interimResults: true,
      languages: { 'en-IN': 'native', 'hi-IN': 'native', hinglish: 'approximate' },
      dataLocation: `Audio is sent by the browser to ${vendor}'s speech recognition servers.`,
      thirdParty: true,
      worksOffline: false,
      canRetainAudio: false,
      pauseResume: true,
      levelMeter: false,
      vocabulary: false,
    };
  }

  async checkAvailability(): Promise<SpeechAvailability> {
    if (!getCtor()) return { available: false, reason: 'This browser has no built-in speech recognition.' };
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia?.('(display-mode: standalone)').matches;
    if (standalone && isSafari())
      return {
        available: true,
        reason: 'Safari may block speech recognition in Home Screen apps. If it fails, open the app in Safari instead.',
      };
    return { available: true };
  }

  createSession(options: SpeechSessionOptions): SpeechSession {
    return new BrowserSession(options);
  }
}

class BrowserSession implements SpeechSession {
  private rec: WSR | null = null;
  private active = false; // user wants recognition running
  private emittedFinals = new Set<number>();
  private restarts: number[] = [];
  private startedAt = 0;
  private pausedTotal = 0;
  private pausedAt = 0;
  private utteranceStart: number | null = null;
  private stopResolve: (() => void) | null = null;

  constructor(private readonly options: SpeechSessionOptions) {}

  private now() {
    return performance.now() - this.startedAt - this.pausedTotal;
  }

  private create(): WSR {
    const Ctor = getCtor();
    if (!Ctor) throw new SpeechError('unsupported', 'Speech recognition is not available in this browser.');
    const rec = new Ctor();
    rec.lang = this.options.language === 'en-IN' ? 'en-IN' : 'hi-IN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.emittedFinals = new Set();

    rec.onspeechstart = () => this.options.onEvent({ type: 'activity', voice: true });
    rec.onspeechend = () => this.options.onEvent({ type: 'activity', voice: false });
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) {
          if (this.emittedFinals.has(i)) continue;
          this.emittedFinals.add(i);
          const end = this.now();
          this.options.onEvent({ type: 'final', text, startMs: this.utteranceStart ?? end, endMs: end });
          this.utteranceStart = null;
        } else {
          if (this.utteranceStart === null) this.utteranceStart = this.now();
          interim += text;
        }
      }
      this.options.onEvent({ type: 'interim', text: interim.trim() });
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // onend restarts
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.fail(new SpeechError('permission', 'Speech recognition permission was denied (microphone or speech service).'));
      } else if (e.error === 'network') {
        this.fail(new SpeechError('network', 'The browser could not reach its speech service. Check the internet connection.'));
      } else if (e.error === 'language-not-supported') {
        this.fail(new SpeechError('unsupported', `The browser does not support ${rec.lang} recognition.`));
      } else if (e.error === 'audio-capture') {
        this.fail(new SpeechError('no-device', 'No microphone available.'));
      } else {
        this.fail(new SpeechError('unknown', `Speech recognition error: ${e.error}`));
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.options.onEvent({ type: 'interim', text: '' });
      if (this.active) {
        // Safari ends continuous recognition after silence; restart, but not in a tight loop.
        const t = performance.now();
        this.restarts = this.restarts.filter((x) => t - x < 10000);
        if (this.restarts.length > 6) {
          this.fail(new SpeechError('server', 'Speech recognition keeps stopping. Try again or switch engine.'));
          return;
        }
        this.restarts.push(t);
        try {
          this.rec = this.create();
          this.rec.start();
        } catch (err) {
          this.fail(err instanceof SpeechError ? err : new SpeechError('unknown', String(err)));
        }
      } else {
        this.rec = null;
        this.stopResolve?.();
      }
    };
    return rec;
  }

  private fail(error: SpeechError) {
    this.active = false;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
    this.options.onEvent({ type: 'error', error });
    this.stopResolve?.();
  }

  async start(): Promise<void> {
    this.startedAt = performance.now();
    this.active = true;
    this.rec = this.create();
    this.rec.start(); // must run inside the user's tap on iPad
  }

  pause() {
    if (!this.active) return;
    this.active = false;
    this.pausedAt = performance.now();
    try {
      this.rec?.stop(); // delivers any pending final result
    } catch {
      /* ignore */
    }
  }

  resume() {
    if (this.active) return;
    this.pausedTotal += performance.now() - this.pausedAt;
    this.active = true;
    this.rec = this.create();
    this.rec.start();
  }

  async stop(): Promise<RecordedAudio | null> {
    this.active = false;
    if (this.rec) {
      const done = new Promise<void>((r) => (this.stopResolve = r));
      try {
        this.rec.stop();
      } catch {
        this.rec = null;
        return null;
      }
      await Promise.race([done, new Promise((r) => setTimeout(r, 2500))]);
    }
    this.rec = null;
    return null; // the browser engine does not expose the recorded audio
  }

  abort() {
    this.active = false;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }
}
