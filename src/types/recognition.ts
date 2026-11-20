import type { BBox, Stroke } from './handwriting';

export type RecognitionStatus =
  | 'idle' // nothing to do (empty page or never written)
  | 'scheduled' // ink changed, waiting for the writing pause
  | 'recognizing' // request in flight
  | 'recognized' // text is current for the page's ink
  | 'pending-offline' // ink saved, recognition waits for connectivity
  | 'error' // last attempt failed; user can retry
  | 'unavailable'; // provider not configured / not reachable

export interface RecognitionRequest {
  pageId: string;
  revision: number;
  strokes: Stroke[];
  width: number;
  height: number;
  language: 'en_US';
  signal?: AbortSignal;
}

export interface IncrementalRecognitionRequest extends RecognitionRequest {
  changedStrokeIds: string[];
}

export interface RecognizedWord {
  text: string;
  strokeIds: string[];
  bbox?: BBox;
  candidates?: string[];
}

export interface RecognizedLine {
  text: string;
  words: RecognizedWord[];
  strokeIds: string[];
  bbox: BBox | null;
}

export interface RecognitionResult {
  pageId: string;
  revision: number;
  /** Signature of the stroke-ID set the result was computed for. */
  signature: string;
  lines: RecognizedLine[];
  rawText: string;
  provider: string;
  recognizedAt: number;
}

export type RecognitionErrorKind =
  | 'network'
  | 'not-configured'
  | 'auth'
  | 'quota'
  | 'invalid-input'
  | 'too-large'
  | 'server'
  | 'aborted'
  | 'unknown';

export class RecognitionError extends Error {
  readonly kind: RecognitionErrorKind;
  readonly retryable: boolean;

  constructor(kind: RecognitionErrorKind, message: string, retryable = false) {
    super(message);
    this.name = 'RecognitionError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

export interface ProviderAvailability {
  available: boolean;
  requiresNetwork: boolean;
  /** Human readable reason when unavailable. */
  reason?: string;
}

export interface ProviderCapabilities {
  incremental: boolean;
  requiresNetwork: boolean;
  /** Provider returns enough geometry to map words back to strokes. */
  wordStrokeMapping: boolean;
  languages: string[];
}
