import type { HandwritingDocument, PageData } from '../types/document';
import type { InkOperation, Stroke } from '../types/handwriting';
import type { RecognitionResult, RecognitionStatus } from '../types/recognition';
import {
  applyInkOperation,
  dropPageFromHistory,
  invertInkOperation,
  pushHistory,
  type InkHistory,
} from '../handwriting/inkOperations';
import {
  applyRecognitionResult,
  clearPageText,
  editBlock,
  pruneHidden,
  resolveConflict,
  restoreHiddenText,
  revertBlock,
  setPageStatus,
} from '../sync/textSync';
import { createPage } from './documentModel';

export interface EditorState {
  doc: HandwritingDocument | null;
  history: InkHistory;
  /** Bumped on every change that should be persisted. */
  dirtyVersion: number;
}

export type EditorAction =
  | { type: 'load'; doc: HandwritingDocument }
  | { type: 'addStroke'; pageId: string; stroke: Stroke }
  | { type: 'erase'; pageId: string; removed: Stroke[]; added: Stroke[] }
  | { type: 'clearPage'; pageId: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'addPage'; afterPageId?: string }
  | { type: 'deletePage'; pageId: string }
  | { type: 'setTitle'; title: string }
  | {
      type: 'recognition';
      pageId: string;
      revision: number;
      status: RecognitionStatus;
      error?: string | null;
      result?: RecognitionResult;
    }
  | { type: 'editBlock'; pageId: string; blockId: string; value: string }
  | { type: 'resolveConflict'; pageId: string; blockId: string; choice: 'keep-mine' | 'use-new' }
  | { type: 'revertBlock'; pageId: string; blockId: string }
  | { type: 'setTypedText'; pageId: string; value: string }
  | { type: 'clearText'; pageId: string }
  | { type: 'restoreHidden'; pageId: string };

export const initialEditorState: EditorState = { doc: null, history: { undo: [], redo: [] }, dirtyVersion: 0 };

function mapPage(doc: HandwritingDocument, pageId: string, fn: (p: PageData) => PageData): HandwritingDocument {
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (p.id !== pageId) return p;
    const np = fn(p);
    if (np !== p) changed = true;
    return np;
  });
  return changed ? { ...doc, pages, updatedAt: Date.now() } : doc;
}

function withInk(page: PageData, strokes: Stroke[]): PageData {
  const existing = new Set(strokes.map((s) => s.id));
  return {
    ...page,
    strokes,
    inkRevision: page.inkRevision + 1,
    text: setPageStatus(pruneHidden(page.text, existing), strokes.length ? 'scheduled' : 'idle', null),
  };
}

function applyOp(doc: HandwritingDocument, op: InkOperation, inverse: boolean): HandwritingDocument {
  return mapPage(doc, op.pageId, (p) => withInk(p, inverse ? invertInkOperation(p.strokes, op) : applyInkOperation(p.strokes, op)));
}

function dirty(state: EditorState, doc: HandwritingDocument, history = state.history): EditorState {
  if (doc === state.doc && history === state.history) return state;
  return { doc, history, dirtyVersion: state.dirtyVersion + 1 };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'load') return { doc: action.doc, history: { undo: [], redo: [] }, dirtyVersion: 0 };
  const doc = state.doc;
  if (!doc) return state;

  switch (action.type) {
    case 'addStroke': {
      const op: InkOperation = { kind: 'add', pageId: action.pageId, stroke: action.stroke };
      return dirty(state, applyOp(doc, op, false), pushHistory(state.history, op));
    }
    case 'erase': {
      if (!action.removed.length && !action.added.length) return state;
      const op: InkOperation = { kind: 'erase', pageId: action.pageId, removed: action.removed, added: action.added };
      return dirty(state, applyOp(doc, op, false), pushHistory(state.history, op));
    }
    case 'clearPage': {
      const page = doc.pages.find((p) => p.id === action.pageId);
      if (!page || !page.strokes.length) return state;
      const op: InkOperation = { kind: 'clear', pageId: page.id, removed: page.strokes };
      return dirty(state, applyOp(doc, op, false), pushHistory(state.history, op));
    }
    case 'undo': {
      const op = state.history.undo[state.history.undo.length - 1];
      if (!op) return state;
      return dirty(state, applyOp(doc, op, true), {
        undo: state.history.undo.slice(0, -1),
        redo: [...state.history.redo, op],
      });
    }
    case 'redo': {
      const op = state.history.redo[state.history.redo.length - 1];
      if (!op) return state;
      return dirty(state, applyOp(doc, op, false), {
        undo: [...state.history.undo, op],
        redo: state.history.redo.slice(0, -1),
      });
    }
    case 'addPage': {
      const page = createPage();
      const idx = action.afterPageId ? doc.pages.findIndex((p) => p.id === action.afterPageId) : doc.pages.length - 1;
      const pages = [...doc.pages];
      pages.splice(idx + 1, 0, page);
      return dirty(state, { ...doc, pages, updatedAt: Date.now() });
    }
    case 'deletePage': {
      if (doc.pages.length <= 1) {
        // Keep at least one page: replace it with a fresh one.
        return dirty(state, { ...doc, pages: [createPage()], updatedAt: Date.now() }, { undo: [], redo: [] });
      }
      return dirty(
        state,
        { ...doc, pages: doc.pages.filter((p) => p.id !== action.pageId), updatedAt: Date.now() },
        dropPageFromHistory(state.history, action.pageId),
      );
    }
    case 'setTitle': {
      const title = action.title.trim() || 'Untitled notes';
      if (title === doc.title) return state;
      return dirty(state, { ...doc, title, updatedAt: Date.now() });
    }
    case 'recognition': {
      const next = mapPage(doc, action.pageId, (p) => {
        // Revision guard: never let an outdated result overwrite newer ink.
        if (p.inkRevision !== action.revision) return p;
        if (action.status === 'recognized' && action.result) {
          return {
            ...p,
            text: applyRecognitionResult(
              p.text,
              action.result.lines,
              action.result.signature,
              action.result.provider,
              action.result.recognizedAt,
            ),
          };
        }
        const text = setPageStatus(p.text, action.status, action.error ?? null);
        return text === p.text ? p : { ...p, text };
      });
      return dirty(state, next);
    }
    case 'editBlock':
      return dirty(state, mapPage(doc, action.pageId, (p) => ({ ...p, text: editBlock(p.text, action.blockId, action.value) })));
    case 'resolveConflict':
      return dirty(
        state,
        mapPage(doc, action.pageId, (p) => ({ ...p, text: resolveConflict(p.text, action.blockId, action.choice) })),
      );
    case 'revertBlock':
      return dirty(state, mapPage(doc, action.pageId, (p) => ({ ...p, text: revertBlock(p.text, action.blockId) })));
    case 'setTypedText':
      return dirty(
        state,
        mapPage(doc, action.pageId, (p) =>
          p.text.typedText === action.value ? p : { ...p, text: { ...p.text, typedText: action.value } },
        ),
      );
    case 'clearText':
      return dirty(
        state,
        mapPage(doc, action.pageId, (p) => ({ ...p, text: clearPageText(p.text, p.strokes.map((s) => s.id)) })),
      );
    case 'restoreHidden':
      return dirty(state, mapPage(doc, action.pageId, (p) => ({ ...p, text: restoreHiddenText(p.text) })));
  }
}
