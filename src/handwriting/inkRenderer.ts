import type { Stroke } from '../types/handwriting';

/**
 * Stroke renderer shared by live drawing, full redraws and image export, so a
 * stroke looks identical while it is being written and after it is committed.
 *
 * Each point i has a segment: point 0 → midpoint(0,1) as a line, then
 * midpoint(i-1,i) → midpoint(i,i+1) as a quadratic curve through point i, and a
 * tail from the last midpoint to the last point. Segments are stroked one by one
 * so the width can follow pressure.
 */

export function pointWidth(s: Pick<Stroke, 'p' | 'width'>, i: number): number {
  if (!s.p) return s.width;
  const p = s.p[i] ?? 0.5;
  // Apple Pencil reports ~0.1–0.7 in normal writing. Map to 0.45×–1.55× base.
  return s.width * (0.45 + 1.6 * Math.min(1, Math.max(0, p)) * 0.6875);
}

function mid(s: Stroke, i: number): [number, number] {
  return [(s.x[i - 1] + s.x[i]) / 2, (s.y[i - 1] + s.y[i]) / 2];
}

/** Draws the segment belonging to point i (0 ≤ i ≤ n-2). */
export function drawSegment(ctx: CanvasRenderingContext2D, s: Stroke, i: number): void {
  const n = s.x.length;
  if (n < 2 || i < 0 || i > n - 2) return;
  ctx.lineWidth = pointWidth(s, i);
  ctx.beginPath();
  if (i === 0) {
    const [mx, my] = mid(s, 1);
    ctx.moveTo(s.x[0], s.y[0]);
    ctx.lineTo(mx, my);
  } else {
    const [ax, ay] = mid(s, i);
    const [bx, by] = mid(s, i + 1);
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(s.x[i], s.y[i], bx, by);
  }
  ctx.stroke();
}

export function drawTail(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const n = s.x.length;
  if (n < 2) return;
  const [mx, my] = mid(s, n - 1);
  ctx.lineWidth = pointWidth(s, n - 1);
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(s.x[n - 1], s.y[n - 1]);
  ctx.stroke();
}

export function beginStrokeStyle(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const n = s.x.length;
  if (n === 0) return;
  beginStrokeStyle(ctx, s);
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(s.x[0], s.y[0], pointWidth(s, 0) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 0; i <= n - 2; i++) drawSegment(ctx, s, i);
  drawTail(ctx, s);
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[]): void {
  for (const s of strokes) drawStroke(ctx, s);
}
