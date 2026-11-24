import type { RecordedAudio, SpeechEvent, SpeechLanguage } from '../../types/speech';

export type LanguageSupport = 'native' | 'approximate' | 'unsupported';

export interface SpeechProviderCapabilities {
  /** 'native': engine streams words as you speak. 'chunked': utterances are sent after short pauses. */
  streaming: 'native' | 'chunked';
  interimResults: boolean;
  languages: Record<SpeechLanguage, LanguageSupport>;
  /** Plain-language explanation of where audio is processed. */
  dataLocation: string;
  /** True if audio leaves the user's own infrastructure (third-party service). */
  thirdParty: boolean;
  worksOffline: boolean;
  canRetainAudio: boolean;
  pauseResume: boolean;
  levelMeter: boolean;
  vocabulary: boolean;
}

export interface SpeechAvailability {
  available: boolean;
  reason?: string;
  /** Extra details for display (e.g. models loaded on the server). */
  detail?: string;
}

export interface SpeechSessionOptions {
  language: SpeechLanguage;
  /** Comma-separated terms (drug names etc.) to bias recognition. */
  vocabulary: string;
  /** Keep the whole recording as WAV (if the provider can). */
  retainAudio: boolean;
  onEvent(event: SpeechEvent): void;
}

export interface SpeechSession {
  /** Requests the microphone (must be called from a user gesture on iPad) and starts listening. */
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  /** Stops listening, finishes pending recognition, releases the microphone. */
  stop(): Promise<RecordedAudio | null>;
  /** Stops immediately, discarding pending work. */
  abort(): void;
}

/**
 * Contract for speech engines. UI code depends only on this interface, so the
 * engine can change (self-hosted Whisper today; an on-device engine or a
 * different server later) without touching components.
 */
export interface SpeechRecognitionProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: SpeechProviderCapabilities;
  checkAvailability(): Promise<SpeechAvailability>;
  createSession(options: SpeechSessionOptions): SpeechSession;
  /** Re-transcribe a stored clip (16 kHz mono) — used by "Retry". */
  transcribeClip?(clip: Float32Array, language: SpeechLanguage, vocabulary: string): Promise<string>;
}
