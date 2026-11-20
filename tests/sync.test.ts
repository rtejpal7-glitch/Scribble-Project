import { describe, expect, it } from 'vitest';
import { editorReducer, initialEditorState, type EditorState } from '../src/state/editorReducer';
import { createDocument } from '../src/state/documentModel';
import type { Stroke } from '../src/types/handwriting';
import type { RecognizedLine } from '../src/types/recognition';
import { strokeSignature } from '../src/utils/signature';
import { pageFinalText } from '../src/sync/textSync';
import { splitStrokeByCircle } from '../src/utils/strokeUtils';

let seq = 0;
function stroke(pageId: string, x0: number, y0: number): Stroke {
  const id = `s${++seq}`;
  return {
    id,
    pageId,
    x: [x0, x0 + 5, x0 + 10],
    y: [y0, y0 + 2, y0],
    t: [1, 2, 3],
    color: '#000',
    width: 2,
    pointerType: 'pen',
    createdAt: seq,
  };
}

/** Fake recognizer: each stroke is a word; strokes with the same y form a line. */
function recognize(strokes: Stroke[], words: Record<string, string>): RecognizedLine[] {
  const byLine = new Map<number, Stroke[]>();
  for (const s of strokes) byLine.set(s.y[0], [...(byLine.get(s.y[0]) ?? []), s]);
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, ss]) => ({
      text: ss.map((s) => words[s.id]).join(' '),
      strokeIds: ss.map((s) => s.id),
      words: ss.map((s) => ({ text: words[s.id], strokeIds: [s.id] })),
      bbox: { minX: 0, minY: y - 10, maxX: 300, maxY: y + 10 },
    }));
}

function applyRecognition(state: EditorState, words: Record<string, string>): EditorState {
  const page = state.doc!.pages[0];
  return editorReducer(state, {
    type: 'recognition',
    pageId: page.id,
    revision: page.inkRevision,
    status: 'recognized',
    result: {
      pageId: page.id,
      revision: page.inkRevision,
      signature: strokeSignature(page.strokes.map((s) => s.id)),
      lines: recognize(page.strokes, words),
      rawText: '',
      provider: 'test',
      recognizedAt: Date.now(),
    },
  });
}

function setup() {
  const doc = createDocument('t');
  let state = editorReducer(initialEditorState, { type: 'load', doc });
  const pageId = doc.pages[0].id;
  const a = stroke(pageId, 0, 100);
  const b = stroke(pageId, 30, 100);
  const c = stroke(pageId, 0, 140);
  const words = { [a.id]: 'hello', [b.id]: 'world', [c.id]: 'second' };
  for (const s of [a, b, c]) state = editorReducer(state, { type: 'addStroke', pageId, stroke: s });
  state = applyRecognition(state, words);
  return { state, pageId, a, b, c, words };
}

const text = (s: EditorState) => pageFinalText(s.doc!.pages[0].text);

describe('ink ↔ text synchronisation', () => {
  it('builds lines from recognition', () => {
    const { state } = setup();
    expect(text(state)).toBe('hello world\nsecond');
  });

  it('erasing a word removes it from the text', () => {
    let { state, pageId, b, words } = setup();
    state = editorReducer(state, { type: 'erase', pageId, removed: [b], added: [] });
    state = applyRecognition(state, words);
    expect(text(state)).toBe('hello\nsecond');
  });

  it('clearing the page clears its text', () => {
    let { state, pageId, words } = setup();
    state = editorReducer(state, { type: 'clearPage', pageId });
    state = applyRecognition(state, words);
    expect(text(state)).toBe('');
  });

  it('ignores stale recognition results (revision guard)', () => {
    let { state, pageId, b, words } = setup();
    const staleRevision = state.doc!.pages[0].inkRevision;
    state = editorReducer(state, { type: 'erase', pageId, removed: [b], added: [] });
    const before = text(state);
    state = editorReducer(state, {
      type: 'recognition',
      pageId,
      revision: staleRevision,
      status: 'recognized',
      result: {
        pageId,
        revision: staleRevision,
        signature: 'x',
        lines: [{ text: 'STALE', strokeIds: [], words: [], bbox: null }],
        rawText: '',
        provider: 'test',
        recognizedAt: 0,
      },
    });
    expect(text(state)).toBe(before);
    void words;
  });

  it('keeps manual corrections across unrelated handwriting changes', () => {
    let { state, pageId, c, words } = setup();
    const block = state.doc!.pages[0].text.blocks[0];
    state = editorReducer(state, { type: 'editBlock', pageId, blockId: block.id, value: 'Hello, world!' });
    state = editorReducer(state, { type: 'erase', pageId, removed: [c], added: [] });
    state = applyRecognition(state, words);
    expect(text(state)).toBe('Hello, world!');
    expect(state.doc!.pages[0].text.blocks[0].correctedText).toBe('Hello, world!');
  });

  it('flags a conflict when the handwriting under a corrected line changes, and undo restores the edit', () => {
    let { state, pageId, b, words } = setup();
    const block = state.doc!.pages[0].text.blocks[0];
    state = editorReducer(state, { type: 'editBlock', pageId, blockId: block.id, value: 'Hello, world!' });
    state = editorReducer(state, { type: 'erase', pageId, removed: [b], added: [] });
    state = applyRecognition(state, words);
    const changed = state.doc!.pages[0].text.blocks[0];
    expect(changed.recognizedText).toBe('hello');
    expect(changed.correctedText).toBeNull();
    expect(changed.conflict?.previousCorrection).toBe('Hello, world!');
    expect(text(state)).toBe('hello\nsecond');

    state = editorReducer(state, { type: 'undo' });
    state = applyRecognition(state, words);
    expect(text(state)).toBe('Hello, world!\nsecond');
    expect(state.doc!.pages[0].text.blocks[0].conflict).toBeNull();
  });

  it('undo/redo of an erase restores identical strokes', () => {
    let { state, pageId, a, words } = setup();
    const ids = () => state.doc!.pages[0].strokes.map((s) => s.id).sort();
    const original = ids();
    state = editorReducer(state, { type: 'erase', pageId, removed: [a], added: [] });
    expect(ids()).not.toContain(a.id);
    state = editorReducer(state, { type: 'undo' });
    expect(ids()).toEqual(original);
    state = editorReducer(state, { type: 'redo' });
    state = applyRecognition(state, words);
    expect(text(state)).toBe('world\nsecond');
  });

  it('clear text hides current lines but new writing still converts', () => {
    let { state, pageId, words } = setup();
    state = editorReducer(state, { type: 'clearText', pageId });
    expect(text(state)).toBe('');
    const d = stroke(pageId, 0, 180);
    state = editorReducer(state, { type: 'addStroke', pageId, stroke: d });
    state = applyRecognition(state, { ...words, [d.id]: 'new' });
    expect(text(state)).toBe('new');
    state = editorReducer(state, { type: 'restoreHidden', pageId });
    expect(text(state)).toBe('hello world\nsecond\nnew');
  });
});

describe('paragraphs', () => {
  it('starts a new paragraph after a skipped ruled line', () => {
    let { state, pageId, words } = setup();
    const d = stroke(pageId, 0, 230); // two ruled lines below "second"
    state = editorReducer(state, { type: 'addStroke', pageId, stroke: d });
    state = applyRecognition(state, { ...words, [d.id]: 'paragraph' });
    expect(text(state)).toBe('hello world\nsecond\n\nparagraph');
  });
});

describe('partial erasing', () => {
  it('splits a stroke into surviving pieces with new IDs', () => {
    const s: Stroke = {
      id: 'orig',
      pageId: 'p',
      x: [0, 100],
      y: [0, 0],
      t: [0, 100],
      color: '#000',
      width: 2,
      pointerType: 'mouse',
      createdAt: 1,
    };
    const pieces = splitStrokeByCircle(s, 50, 0, 10)!;
    expect(pieces).toHaveLength(2);
    expect(pieces.every((p) => p.id !== 'orig')).toBe(true);
    expect(Math.max(...pieces[0].x)).toBeLessThan(41);
    expect(Math.min(...pieces[1].x)).toBeGreaterThan(59);
    expect(splitStrokeByCircle(s, 50, 50, 5)).toBeNull();
  });
});
