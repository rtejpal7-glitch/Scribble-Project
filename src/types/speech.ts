/**
 * Voice-to-text data model. Deliberately separate from the handwriting model:
 * a voice document holds transcript segments and recording metadata, never ink.
 */

export type SpeechLanguage = 'en-IN' | 'hi-IN' | 'hinglish';

export interface SpeechLanguageInfo {
  id: SpeechLanguage;
  label: string;
  short: string;
  description: string;
}

export const SPEECH_LANGUAGES: SpeechLanguageInfo[] = [
  { id: 'en-IN', label: 'English (India)', short: 'English', description: 'Indian English dictation' },
  { id: 'hi-IN', label: 'Hindi (India)', short: 'हिन्दी', description: 'Hindi, written in Devanagari' },
  {
    id: 'hinglish',
    label: 'Hinglish',
    short: 'Hinglish',
    description: 'Hindi + English mixed in one sentence, written as spoken (Roman script)',
  },
];

export type SpeechEngineId = 'server' | 'browser';

export interface TranscriptSegment {
  id: string;
  /** Recording this segment came from (null for typed text). */
  recordingId: string | null;
  /** Current text, including the user's edits. */
  text: string;
  /** Text exactly as recognised (kept so edits can be compared / reverted). */
  recognizedText: string;
  edited: boolean;
  source: 'speech' | 'typed';
  status: 'final' | 'failed';
  error?: string;
  /** Offsets within the recording (paused time excluded). */
  startMs: number | null;
  endMs: number | null;
  language: SpeechLanguage;
  engine: string;
  paragraphStart: boolean;
  createdAt: number;
  /** Result of the sentence check for `forText` (stale once the text changes). */
  review?: SentenceReview;
}

export interface SentenceReview {
  forText: string;
  /** Proposed sentence, or null when the sentence was checked and looks fine. */
  suggestion: string | null;
  reason?: string;
  dismissed?: boolean;
}

export interface RecordingInfo {
  id: string;
  startedAt: number;
  durationMs: number;
  language: SpeechLanguage;
  engine: string;
  /** Audio kept in local storage (only if the user enabled audio retention). */
  audioStored: boolean;
}

export interface EvaluationResult {
  id: string;
  createdAt: number;
  language: SpeechLanguage;
  engine: string;
  reference: string;
  hypothesis: string;
  wer: number;
  cer: number;
  referenceWords: number;
  note: string;
}

export interface VoiceDocument {
  schemaVersion: 1;
  kind: 'voice';
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  language: SpeechLanguage;
  segments: TranscriptSegment[];
  recordings: RecordingInfo[];
  evaluations: EvaluationResult[];
}

/** What a host application (e.g. ClinicFlow) receives. */
export interface VoiceSnapshot {
  documentId: string;
  title: string;
  updatedAt: number;
  language: SpeechLanguage;
  /** Final text with edits, paragraphs separated by blank lines. */
  text: string;
  /** Text as recognised, without manual edits. */
  recognizedText: string;
  hasManualEdits: boolean;
  segments: TranscriptSegment[];
  recordings: RecordingInfo[];
}

/* ------------------------------ live session ------------------------------ */

export type SpeechErrorKind =
  | 'permission'
  | 'no-device'
  | 'unsupported'
  | 'not-configured'
  | 'auth'
  | 'network'
  | 'server'
  | 'aborted'
  | 'unknown';

export class SpeechError extends Error {
  readonly kind: SpeechErrorKind;
  constructor(kind: SpeechErrorKind, message: string) {
    super(message);
    this.name = 'SpeechError';
    this.kind = kind;
  }
}

export type SpeechEvent =
  /** Provisional text for the utterance being spoken (replaced by `final`). */
  | { type: 'interim'; text: string }
  /** Confirmed text for one utterance. */
  | { type: 'final'; text: string; startMs: number | null; endMs: number | null; clip?: Float32Array }
  /** An utterance could not be transcribed; `clip` allows a retry. */
  | { type: 'failed'; error: string; startMs: number | null; endMs: number | null; clip?: Float32Array }
  /** Voice activity detected / ended (audio capture). */
  | { type: 'activity'; voice: boolean }
  | { type: 'level'; level: number }
  /** Number of utterances waiting for recognition. */
  | { type: 'pending'; count: number }
  /** Fatal error: the session has stopped. */
  | { type: 'error'; error: SpeechError };

export interface RecordedAudio {
  wav: Blob;
  durationMs: number;
}
