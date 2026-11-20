import type { InkOperation, Stroke } from '../types/handwriting';
import { sortStrokes } from '../utils/strokeUtils';

/**
 * Pure functions that apply / invert ink operations on a page's stroke list.
 * Erasing really removes stroke data (and partial erasing replaces a stroke with
 * its surviving pieces), so erased ink can never reappear in recognition,
 * reload or export. Undo restores the exact original strokes (same IDs).
 */

export function applyInkOperation(strokes: Stroke[], op: InkOperation): Stroke[] {
  switch (op.kind) {
    case 'add':
      return [...strokes, op.stroke];
    case 'erase': {
      const removed = new Set(op.removed.map((s) => s.id));
      const kept = strokes.filter((s) => !removed.has(s.id));
      return op.added.length ? sortStrokes([...kept, ...op.added]) : kept;
    }
    case 'clear':
      return [];
  }
}

export function invertInkOperation(strokes: Stroke[], op: InkOperation): Stroke[] {
  switch (op.kind) {
    case 'add':
      return strokes.filter((s) => s.id !== op.stroke.id);
    case 'erase': {
      const added = new Set(op.added.map((s) => s.id));
      return sortStrokes([...strokes.filter((s) => !added.has(s.id)), ...op.removed]);
    }
    case 'clear':
      return sortStrokes([...strokes, ...op.removed]);
  }
}

export interface InkHistory {
  undo: InkOperation[];
  redo: InkOperation[];
}

export const HISTORY_LIMIT = 300;

export function pushHistory(h: InkHistory, op: InkOperation): InkHistory {
  const undo = [...h.undo, op];
  if (undo.length > HISTORY_LIMIT) undo.splice(0, undo.length - HISTORY_LIMIT);
  return { undo, redo: [] };
}

export function dropPageFromHistory(h: InkHistory, pageId: string): InkHistory {
  return {
    undo: h.undo.filter((o) => o.pageId !== pageId),
    redo: h.redo.filter((o) => o.pageId !== pageId),
  };
}
