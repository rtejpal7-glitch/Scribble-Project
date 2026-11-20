import type { BBox, Stroke } from './handwriting';
import type { RecognitionStatus, RecognizedLine } from './recognition';

/**
 * One recognised line of handwriting, bound to the exact strokes it came from.
 * `signature` is a hash of the sorted stroke IDs and is the key used to carry
 * manual corrections across re-recognition, undo and redo.
 */
export interface TextBlock {
  id: string;
  strokeIds: string[];
  signature: string;
  recognizedText: string;
  /** User's manual correction. `null` means "show the recognised text". */
  correctedText: string | null;
  /**
   * Set when the handwriting under a corrected line changed. The block then shows
   * the new recognition, and the user decides whether to restore their edit.
   */
  conflict: { previousCorrection: string; previousRecognized: string } | null;
  /** True if a paragraph starts at this line (larger vertical gap above it). */
  paragraphStart: boolean;
  bbox: BBox | null;
}

export interface CorrectionMemoryEntry {
  signature: string;
  recognizedText: string;
  correctedText: string;
  updatedAt: number;
}

export interface PageText {
  status: RecognitionStatus;
  error: string | null;
  /** Lines from the most recent recognition (source of truth for `blocks`). */
  lines: RecognizedLine[];
  blocks: TextBlock[];
  /** Free text typed on the keyboard for this page; not linked to ink. */
  typedText: string;
  /** Manual corrections keyed by stroke signature (survive undo / redo). */
  corrections: Record<string, CorrectionMemoryEntry>;
  /** Strokes whose lines the user removed from the text with "Clear text". */
  hiddenStrokeIds: string[];
  lastRecognizedAt: number | null;
  /** Stroke signature the current `lines` were recognised from. */
  recognizedSignature: string | null;
  provider: string | null;
}

export interface PageData {
  id: string;
  createdAt: number;
  strokes: Stroke[];
  /** Incremented on every ink change; used to discard stale recognition. */
  inkRevision: number;
  text: PageText;
}

export interface HandwritingDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pages: PageData[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  preview: string;
}

/* ---------- Snapshot types handed to host applications (e.g. ClinicFlow) ---------- */

export interface PageSnapshot {
  pageId: string;
  pageNumber: number;
  strokes: Stroke[];
  /** Text exactly as recognised (no manual corrections). */
  recognizedText: string;
  /** Final text: corrections applied, typed notes appended. */
  text: string;
  hasManualEdits: boolean;
  typedText: string;
  recognitionStatus: RecognitionStatus;
  lastRecognizedAt: number | null;
}

export interface HandwritingSnapshot {
  documentId: string;
  title: string;
  updatedAt: number;
  pages: PageSnapshot[];
  /** All pages' final text joined in page order. */
  text: string;
  recognizedText: string;
  /** Overall status: the "least done" status across pages. */
  recognitionStatus: RecognitionStatus;
}
