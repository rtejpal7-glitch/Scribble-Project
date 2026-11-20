import type { BBox, Stroke } from '../types/handwriting';
import type { RecognizedLine, RecognizedWord } from '../types/recognition';
import { bboxIntersectionArea, bboxUnion, strokeBBox } from '../utils/strokeUtils';

/**
 * Parser for MyScript JIIX ("JSON Interactive Ink eXchange") text output.
 * JIIX geometry is in millimetres. Input is sent at 96 DPI, so 1 mm = 96 / 25.4 units.
 *
 * Mapping words back to our strokes:
 *  1. If the word's `items` echo stroke points (export.jiix.strokes = true), match
 *     each item to one of our strokes by its first and last point. This is exact.
 *  2. Any stroke still unmatched goes to the word whose bounding box overlaps it
 *     most. This covers engines or configs that return only bounding boxes.
 */

interface JiixBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface JiixItem {
  type?: string;
  id?: string;
  'full-id'?: string;
  X?: number[];
  Y?: number[];
}
interface JiixWord {
  label?: string;
  candidates?: string[];
  'bounding-box'?: JiixBox;
  items?: JiixItem[];
}
export interface JiixDocument {
  type?: string;
  label?: string;
  words?: JiixWord[];
  elements?: Array<{ type?: string; label?: string; words?: JiixWord[] }>;
}

const MM_TO_UNITS = 96 / 25.4;

function boxToUnits(b: JiixBox): BBox {
  return {
    minX: b.x * MM_TO_UNITS,
    minY: b.y * MM_TO_UNITS,
    maxX: (b.x + b.width) * MM_TO_UNITS,
    maxY: (b.y + b.height) * MM_TO_UNITS,
  };
}

function collectWords(doc: JiixDocument): JiixWord[] {
  if (Array.isArray(doc.words)) return doc.words;
  const out: JiixWord[] = [];
  for (const el of doc.elements ?? []) {
    if (Array.isArray(el.words)) {
      if (out.length) out.push({ label: '\n' });
      out.push(...el.words);
    }
  }
  return out;
}

class StrokeIndex {
  private grid = new Map<string, Stroke[]>();
  private byId = new Map<string, Stroke>();
  readonly assigned = new Set<string>();

  constructor(strokes: Stroke[]) {
    for (const s of strokes) {
      this.byId.set(s.id, s);
      const key = this.key(s.x[0], s.y[0]);
      const list = this.grid.get(key);
      if (list) list.push(s);
      else this.grid.set(key, [s]);
    }
  }
  private key(x: number, y: number) {
    return `${Math.floor(x / 4)}:${Math.floor(y / 4)}`;
  }
  get(id: string) {
    return this.byId.get(id);
  }
  match(item: JiixItem): string | null {
    for (const id of [item['full-id'], item.id]) {
      if (id && this.byId.has(id) && !this.assigned.has(id)) return id;
    }
    if (!item.X?.length || !item.Y?.length) return null;
    const fx = item.X[0] * MM_TO_UNITS,
      fy = item.Y[0] * MM_TO_UNITS;
    const lx = item.X[item.X.length - 1] * MM_TO_UNITS,
      ly = item.Y[item.Y.length - 1] * MM_TO_UNITS;
    const gx = Math.floor(fx / 4),
      gy = Math.floor(fy / 4);
    let best: Stroke | null = null;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of this.grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
          if (this.assigned.has(s.id)) continue;
          const d0 = Math.hypot(s.x[0] - fx, s.y[0] - fy);
          if (d0 > 3) continue;
          const n = s.x.length - 1;
          const d = d0 + Math.hypot(s.x[n] - lx, s.y[n] - ly);
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
      }
    return best ? best.id : null;
  }
}

interface WorkingWord extends RecognizedWord {
  lineIndex: number;
}

export function parseJiixText(doc: JiixDocument, strokes: Stroke[]): { lines: RecognizedLine[]; rawText: string } {
  const words = collectWords(doc);
  const index = new StrokeIndex(strokes);

  // Pass 1: tokens → lines, exact item matching.
  const lineTokens: Array<Array<WorkingWord | ' '>> = [[]];
  const allWords: WorkingWord[] = [];
  for (const w of words) {
    const label = w.label ?? '';
    if (label.includes('\n') && label.trim() === '') {
      const breaks = label.split('\n').length - 1;
      for (let i = 0; i < breaks; i++) lineTokens.push([]);
      continue;
    }
    if (label.trim() === '') {
      lineTokens[lineTokens.length - 1].push(' ');
      continue;
    }
    const ww: WorkingWord = {
      text: label,
      strokeIds: [],
      bbox: w['bounding-box'] ? boxToUnits(w['bounding-box']) : undefined,
      candidates: w.candidates,
      lineIndex: lineTokens.length - 1,
    };
    for (const item of w.items ?? []) {
      if (item.type && item.type !== 'stroke') continue;
      const id = index.match(item);
      if (id) {
        index.assigned.add(id);
        ww.strokeIds.push(id);
      }
    }
    lineTokens[lineTokens.length - 1].push(ww);
    allWords.push(ww);
  }

  // Pass 2: geometric fallback for strokes not matched exactly.
  const wordsWithBox = allWords.filter((w) => w.bbox);
  if (wordsWithBox.length) {
    for (const s of strokes) {
      if (index.assigned.has(s.id)) continue;
      const sb = strokeBBox(s);
      let best: WorkingWord | null = null;
      let bestScore = 0;
      for (const w of wordsWithBox) {
        const pad = 2;
        const wb = w.bbox!;
        const score = bboxIntersectionArea(sb, {
          minX: wb.minX - pad,
          minY: wb.minY - pad,
          maxX: wb.maxX + pad,
          maxY: wb.maxY + pad,
        });
        if (score > bestScore) {
          bestScore = score;
          best = w;
        }
      }
      if (best) {
        best.strokeIds.push(s.id);
        index.assigned.add(s.id);
      }
    }
  }

  // Build lines.
  const lines: RecognizedLine[] = [];
  for (const tokens of lineTokens) {
    let text = '';
    const lineWords: RecognizedWord[] = [];
    let bbox: BBox | null = null;
    for (const t of tokens) {
      if (t === ' ') {
        text += ' ';
        continue;
      }
      text += t.text;
      const { lineIndex: _li, ...word } = t;
      lineWords.push(word);
      if (word.bbox) bbox = bboxUnion(bbox, word.bbox);
      else
        for (const id of word.strokeIds) {
          const s = index.get(id);
          if (s) bbox = bboxUnion(bbox, strokeBBox(s));
        }
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const strokeIds = Array.from(new Set(lineWords.flatMap((w) => w.strokeIds)));
    lines.push({ text, words: lineWords, strokeIds, bbox });
  }

  const rawText = typeof doc.label === 'string' ? doc.label : lines.map((l) => l.text).join('\n');
  return { lines, rawText };
}
