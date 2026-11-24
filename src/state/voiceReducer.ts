import type {
  EvaluationResult,
  RecordingInfo,
  SpeechLanguage,
  TranscriptSegment,
  VoiceDocument,
} from '../types/speech';
import { createId } from '../utils/id';

export function createVoiceDocument(title = 'Untitled dictation', id: string = createId('v_'), language: SpeechLanguage = 'hinglish'): VoiceDocument {
  const now = Date.now();
  return { schemaVersion: 1, kind: 'voice', id, title, createdAt: now, updatedAt: now, language, segments: [], recordings: [], evaluations: [] };
}

export function normalizeVoiceDocument(raw: VoiceDocument): VoiceDocument {
  return {
    schemaVersion: 1,
    kind: 'voice',
    id: raw.id,
    title: raw.title || 'Untitled dictation',
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    language: raw.language ?? 'hinglish',
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    recordings: Array.isArray(raw.recordings) ? raw.recordings : [],
    evaluations: Array.isArray(raw.evaluations) ? raw.evaluations : [],
  };
}

/* ------------------------------ undo / redo ------------------------------ */
/*
 * History holds *operations*, not snapshots: undoing an edit restores that
 * segment only, so it never removes text that was recognised afterwards.
 */
export type VoiceOp =
  | { kind: 'edit'; id: string; before: string; after: string; at: number }
  | { kind: 'insert'; segment: TranscriptSegment; index: number }
  | { kind: 'delete'; segment: TranscriptSegment; index: number }
  | { kind: 'clear'; segments: TranscriptSegment[] }
  | { kind: 'paragraph'; id: string; before: boolean };

const EDIT_COALESCE_MS = 1200;
const HISTORY_LIMIT = 200;

function setText(s: TranscriptSegment, text: string): TranscriptSegment {
  return { ...s, text, edited: s.source === 'speech' ? text !== s.recognizedText : s.edited };
}

function apply(segments: TranscriptSegment[], op: VoiceOp, inverse: boolean): TranscriptSegment[] {
  switch (op.kind) {
    case 'edit':
      return segments.map((s) => (s.id === op.id ? setText(s, inverse ? op.before : op.after) : s));
    case 'paragraph':
      return segments.map((s) => (s.id === op.id ? { ...s, paragraphStart: inverse ? op.before : !op.before } : s));
    case 'insert':
    case 'delete': {
      const removing = (op.kind === 'insert') === inverse;
      if (removing) return segments.filter((s) => s.id !== op.segment.id);
      const next = segments.filter((s) => s.id !== op.segment.id);
      next.splice(Math.min(op.index, next.length), 0, op.segment);
      return next;
    }
    case 'clear': {
      if (!inverse) {
        const ids = new Set(op.segments.map((s) => s.id));
        return segments.filter((s) => !ids.has(s.id));
      }
      // Restore cleared segments before anything recognised after the clear.
      const present = new Set(segments.map((s) => s.id));
      return [...op.segments.filter((s) => !present.has(s.id)), ...segments];
    }
  }
}

/* --------------------------------- reducer --------------------------------- */

export interface VoiceState {
  doc: VoiceDocument | null;
  undo: VoiceOp[];
  redo: VoiceOp[];
  dirtyVersion: number;
}

export const initialVoiceState: VoiceState = { doc: null, undo: [], redo: [], dirtyVersion: 0 };

export type NewSegment = Omit<TranscriptSegment, 'id' | 'createdAt' | 'recognizedText' | 'edited'> & { id?: string };

export type VoiceAction =
  | { type: 'load'; doc: VoiceDocument }
  | { type: 'setTitle'; title: string }
  | { type: 'setLanguage'; language: SpeechLanguage }
  | { type: 'recordingStarted'; recording: RecordingInfo }
  | { type: 'recordingFinished'; recordingId: string; durationMs: number; audioStored: boolean }
  | { type: 'appendSegment'; segment: NewSegment }
  | { type: 'retrySucceeded'; segmentId: string; text: string }
  | { type: 'retryFailed'; segmentId: string; error: string }
  | { type: 'editSegment'; segmentId: string; text: string }
  | { type: 'deleteSegment'; segmentId: string }
  | { type: 'toggleParagraph'; segmentId: string }
  | { type: 'addTypedSegment'; text: string; afterSegmentId?: string }
  | { type: 'clearTranscript' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'audioDeleted'; recordingId: string }
  | { type: 'addEvaluation'; result: EvaluationResult }
  | { type: 'deleteEvaluation'; id: string };

function touch(doc: VoiceDocument, patch: Partial<VoiceDocument>): VoiceDocument {
  return { ...doc, ...patch, updatedAt: Date.now() };
}

function withOp(state: VoiceState, doc: VoiceDocument, op: VoiceOp): VoiceState {
  const last = state.undo[state.undo.length - 1];
  let undo: VoiceOp[];
  if (op.kind === 'edit' && last?.kind === 'edit' && last.id === op.id && op.at - last.at < EDIT_COALESCE_MS) {
    undo = [...state.undo.slice(0, -1), { ...last, after: op.after, at: op.at }];
  } else {
    undo = [...state.undo, op].slice(-HISTORY_LIMIT);
  }
  return { doc, undo, redo: [], dirtyVersion: state.dirtyVersion + 1 };
}

function changed(state: VoiceState, doc: VoiceDocument): VoiceState {
  return { ...state, doc, dirtyVersion: state.dirtyVersion + 1 };
}

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  if (action.type === 'load') return { doc: action.doc, undo: [], redo: [], dirtyVersion: 0 };
  const doc = state.doc;
  if (!doc) return state;

  switch (action.type) {
    case 'setTitle': {
      const title = action.title.trim() || 'Untitled dictation';
      return title === doc.title ? state : changed(state, touch(doc, { title }));
    }
    case 'setLanguage':
      return action.language === doc.language ? state : changed(state, touch(doc, { language: action.language }));
    case 'recordingStarted':
      return changed(state, touch(doc, { recordings: [...doc.recordings, action.recording] }));
    case 'recordingFinished':
      return changed(
        state,
        touch(doc, {
          recordings: doc.recordings.map((r) =>
            r.id === action.recordingId ? { ...r, durationMs: action.durationMs, audioStored: action.audioStored } : r,
          ),
        }),
      );
    case 'appendSegment': {
      const s = action.segment;
      const seg: TranscriptSegment = {
        ...s,
        id: s.id ?? createId('t_'),
        recognizedText: s.text,
        edited: false,
        createdAt: Date.now(),
        paragraphStart: s.paragraphStart || doc.segments.length === 0,
      };
      return changed(state, touch(doc, { segments: [...doc.segments, seg] }));
    }
    case 'retrySucceeded':
      return changed(
        state,
        touch(doc, {
          segments: doc.segments.map((s) =>
            s.id === action.segmentId
              ? { ...s, status: 'final', error: undefined, recognizedText: action.text, text: s.edited ? s.text : action.text }
              : s,
          ),
        }),
      );
    case 'retryFailed':
      return changed(
        state,
        touch(doc, { segments: doc.segments.map((s) => (s.id === action.segmentId ? { ...s, error: action.error } : s)) }),
      );
    case 'editSegment': {
      const seg = doc.segments.find((s) => s.id === action.segmentId);
      if (!seg || seg.text === action.text) return state;
      const op: VoiceOp = { kind: 'edit', id: seg.id, before: seg.text, after: action.text, at: Date.now() };
      return withOp(state, touch(doc, { segments: apply(doc.segments, op, false) }), op);
    }
    case 'deleteSegment': {
      const index = doc.segments.findIndex((s) => s.id === action.segmentId);
      if (index < 0) return state;
      const op: VoiceOp = { kind: 'delete', segment: doc.segments[index], index };
      return withOp(state, touch(doc, { segments: apply(doc.segments, op, false) }), op);
    }
    case 'toggleParagraph': {
      const seg = doc.segments.find((s) => s.id === action.segmentId);
      if (!seg) return state;
      const op: VoiceOp = { kind: 'paragraph', id: seg.id, before: seg.paragraphStart };
      return withOp(state, touch(doc, { segments: apply(doc.segments, op, false) }), op);
    }
    case 'addTypedSegment': {
      const after = action.afterSegmentId ? doc.segments.findIndex((s) => s.id === action.afterSegmentId) : -1;
      const index = after >= 0 ? after + 1 : doc.segments.length;
      const segment: TranscriptSegment = {
        id: createId('t_'),
        recordingId: null,
        text: action.text,
        recognizedText: '',
        edited: false,
        source: 'typed',
        status: 'final',
        startMs: null,
        endMs: null,
        language: doc.language,
        engine: 'keyboard',
        paragraphStart: true,
        createdAt: Date.now(),
      };
      const op: VoiceOp = { kind: 'insert', segment, index };
      return withOp(state, touch(doc, { segments: apply(doc.segments, op, false) }), op);
    }
    case 'clearTranscript': {
      if (!doc.segments.length) return state;
      const op: VoiceOp = { kind: 'clear', segments: doc.segments };
      return withOp(state, touch(doc, { segments: [] }), op);
    }
    case 'undo': {
      const op = state.undo[state.undo.length - 1];
      if (!op) return state;
      return {
        doc: touch(doc, { segments: apply(doc.segments, op, true) }),
        undo: state.undo.slice(0, -1),
        redo: [...state.redo, op],
        dirtyVersion: state.dirtyVersion + 1,
      };
    }
    case 'redo': {
      const op = state.redo[state.redo.length - 1];
      if (!op) return state;
      return {
        doc: touch(doc, { segments: apply(doc.segments, op, false) }),
        undo: [...state.undo, op],
        redo: state.redo.slice(0, -1),
        dirtyVersion: state.dirtyVersion + 1,
      };
    }
    case 'audioDeleted':
      return changed(
        state,
        touch(doc, { recordings: doc.recordings.map((r) => (r.id === action.recordingId ? { ...r, audioStored: false } : r)) }),
      );
    case 'addEvaluation':
      return changed(state, touch(doc, { evaluations: [action.result, ...doc.evaluations] }));
    case 'deleteEvaluation':
      return changed(state, touch(doc, { evaluations: doc.evaluations.filter((e) => e.id !== action.id) }));
  }
}
