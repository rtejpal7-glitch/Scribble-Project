import type { BBox, Stroke } from '../types/handwriting';
import { createId } from './id';

export function strokeBBox(s: Pick<Stroke, 'x' | 'y' | 'width'>): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < s.x.length; i++) {
    const x = s.x[i],
      y = s.y[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = s.width;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function bboxIntersectionArea(a: BBox, b: BBox): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

export function bboxUnion(a: BBox | null, b: BBox): BBox {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Squared distance from point P to segment AB. */
export function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px,
    cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** True if a circle (eraser) touches the stroke's centre line. */
export function strokeHitsCircle(s: Stroke, cx: number, cy: number, r: number): boolean {
  const rr = (r + s.width / 2) ** 2;
  const n = s.x.length;
  if (n === 1) return (s.x[0] - cx) ** 2 + (s.y[0] - cy) ** 2 <= rr;
  for (let i = 1; i < n; i++) {
    if (distSqToSegment(cx, cy, s.x[i - 1], s.y[i - 1], s.x[i], s.y[i]) <= rr) return true;
  }
  return false;
}

/**
 * Partial erasing: removes the parts of a stroke inside the eraser circle and
 * returns the surviving pieces as *new* strokes (new IDs, same style and z-order).
 * Returns `null` when the circle does not touch the stroke.
 */
export function splitStrokeByCircle(s: Stroke, cx: number, cy: number, r: number): Stroke[] | null {
  if (!strokeHitsCircle(s, cx, cy, r)) return null;
  const rr = (r + s.width * 0.25) ** 2;
  const step = Math.max(0.75, r / 3);

  // Densify so a fast stroke with sparse points is cut precisely.
  const xs: number[] = [],
    ys: number[] = [],
    ts: number[] = [],
    ps: number[] | null = s.p ? [] : null;
  for (let i = 0; i < s.x.length; i++) {
    if (i > 0) {
      const dx = s.x[i] - s.x[i - 1],
        dy = s.y[i] - s.y[i - 1];
      const d = Math.hypot(dx, dy);
      const extra = Math.floor(d / step);
      for (let k = 1; k <= extra; k++) {
        const f = k / (extra + 1);
        xs.push(s.x[i - 1] + dx * f);
        ys.push(s.y[i - 1] + dy * f);
        ts.push(Math.round(s.t[i - 1] + (s.t[i] - s.t[i - 1]) * f));
        if (ps && s.p) ps.push(s.p[i - 1] + (s.p[i] - s.p[i - 1]) * f);
      }
    }
    xs.push(s.x[i]);
    ys.push(s.y[i]);
    ts.push(s.t[i]);
    if (ps && s.p) ps.push(s.p[i]);
  }

  const pieces: Stroke[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= 2) {
      pieces.push({
        ...s,
        id: createId('s_'),
        x: cur.map((i) => xs[i]),
        y: cur.map((i) => ys[i]),
        t: cur.map((i) => ts[i]),
        p: ps ? cur.map((i) => ps[i]) : undefined,
      });
    }
    cur = [];
  };
  let removedAny = false;
  for (let i = 0; i < xs.length; i++) {
    const inside = (xs[i] - cx) ** 2 + (ys[i] - cy) ** 2 <= rr;
    if (inside) {
      removedAny = true;
      flush();
    } else cur.push(i);
  }
  flush();
  if (!removedAny) return null;
  if (!s.p) for (const p of pieces) delete p.p;
  return pieces;
}

/** Points along the segment from (ax,ay) to (bx,by) every `step` units (inclusive of end). */
export function samplePath(ax: number, ay: number, bx: number, by: number, step: number): Array<[number, number]> {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(d / step));
  const out: Array<[number, number]> = [];
  for (let i = 1; i <= n; i++) out.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  return out;
}

export function sortStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.slice().sort((a, b) => a.createdAt - b.createdAt);
}

export function countPoints(strokes: Stroke[]): number {
  let n = 0;
  for (const s of strokes) n += s.x.length;
  return n;
}

/**
 * Ramer–Douglas–Peucker simplification. Returns the indices of the points to
 * keep (first and last are always kept). Apple Pencil reports ~240 points per
 * second; most are redundant for recognition, and sending fewer points makes
 * requests smaller and recognition faster without changing letter shapes.
 */
export function simplifyIndices(xs: readonly number[], ys: readonly number[], tolerance: number): number[] {
  const n = xs.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distSqToSegment(xs[i], ys[i], xs[a], ys[a], xs[b], ys[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}
