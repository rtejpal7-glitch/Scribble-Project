import { describe, expect, it } from 'vitest';
import { parseJiixText } from '../src/recognition/jiix';
import type { Stroke } from '../src/types/handwriting';

const MM = 25.4 / 96;
function s(id: string, x: number, y: number): Stroke {
  return { id, pageId: 'p', x: [x, x + 20], y: [y, y + 4], t: [0, 10], color: '#000', width: 2, pointerType: 'pen', createdAt: 0 };
}
const box = (x: number, y: number, w: number, h: number) => ({ x: x * MM, y: y * MM, width: w * MM, height: h * MM });

describe('JIIX parsing', () => {
  const strokes = [s('a', 100, 100), s('b', 200, 100), s('c', 100, 200)];

  it('maps words to strokes via echoed stroke items', () => {
    const jiix = {
      type: 'Text',
      label: 'hi there\nnext',
      words: [
        { label: 'hi', 'bounding-box': box(95, 90, 30, 20), items: [{ type: 'stroke', X: [100 * MM, 120 * MM], Y: [100 * MM, 104 * MM] }] },
        { label: ' ' },
        { label: 'there', 'bounding-box': box(195, 90, 30, 20), items: [{ type: 'stroke', X: [200 * MM, 220 * MM], Y: [100 * MM, 104 * MM] }] },
        { label: '\n' },
        { label: 'next', 'bounding-box': box(95, 190, 30, 20), items: [{ type: 'stroke', X: [100 * MM, 120 * MM], Y: [200 * MM, 204 * MM] }] },
      ],
    };
    const { lines } = parseJiixText(jiix, strokes);
    expect(lines.map((l) => l.text)).toEqual(['hi there', 'next']);
    expect(lines[0].strokeIds.sort()).toEqual(['a', 'b']);
    expect(lines[1].strokeIds).toEqual(['c']);
  });

  it('falls back to bounding boxes when stroke items are absent', () => {
    const jiix = {
      words: [
        { label: 'hi', 'bounding-box': box(95, 90, 30, 20) },
        { label: ' ' },
        { label: 'there', 'bounding-box': box(195, 90, 30, 20) },
        { label: '\n' },
        { label: 'next', 'bounding-box': box(95, 190, 30, 20) },
      ],
    };
    const { lines } = parseJiixText(jiix, strokes);
    expect(lines[0].words[0].strokeIds).toEqual(['a']);
    expect(lines[0].words[1].strokeIds).toEqual(['b']);
    expect(lines[1].strokeIds).toEqual(['c']);
  });
});
