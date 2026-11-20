import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PageData } from '../../types/document';
import {
  LINE_SPACING,
  MARGIN_LEFT,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PEN_COLORS,
  RULE_TOP,
  type Stroke,
  type ToolState,
} from '../../types/handwriting';
import { beginStrokeStyle, drawSegment, drawStroke, drawStrokes, drawTail } from '../../handwriting/inkRenderer';
import { samplePath, splitStrokeByCircle, strokeBBox, strokeHitsCircle, bboxIntersects } from '../../utils/strokeUtils';
import { createId } from '../../utils/id';

/** Max backing-store pixels per page canvas (iOS Safari caps canvas memory). */
const MAX_CANVAS_PIXELS = 10_000_000;
const MIN_POINT_DISTANCE = 0.35;
const SMOOTHING = 0.62; // 1 = raw input, lower = smoother but more lag

export interface InkPageProps {
  page: PageData;
  index: number;
  zoom: number;
  tool: ToolState;
  /** Canvas is only mounted while the page is near the viewport. */
  active: boolean;
  scroller: MutableRefObject<HTMLDivElement | null>;
  /** True while a pen is touching the screen (shared, for palm rejection). */
  penDown: MutableRefObject<boolean>;
  onAddStroke(pageId: string, stroke: Stroke): void;
  onErase(pageId: string, removed: Stroke[], added: Stroke[]): void;
  onPenDetected(): void;
}

interface DrawState {
  kind: 'draw';
  pointerId: number;
  stroke: Stroke;
  rect: DOMRect;
  epoch0: number;
  ts0: number;
  lastRaw: [number, number];
}
interface EraseState {
  kind: 'erase';
  pointerId: number;
  rect: DOMRect;
  working: Stroke[];
  boxes: Map<string, ReturnType<typeof strokeBBox>>;
  originalIds: Set<string>;
  removed: Map<string, Stroke>;
  added: Map<string, Stroke>;
  last: [number, number] | null;
}

function backingScale(zoom: number): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cap = Math.sqrt(MAX_CANVAS_PIXELS / (PAGE_WIDTH * PAGE_HEIGHT));
  return Math.min(dpr * zoom, cap);
}

function paperBackground(z: number): CSSProperties {
  const ls = LINE_SPACING * z;
  const offset = (RULE_TOP * z) % ls;
  const ml = MARGIN_LEFT * z;
  const headerEnd = (RULE_TOP - LINE_SPACING / 2) * z;
  return {
    backgroundColor: '#ffffff',
    backgroundImage: [
      `linear-gradient(to right, transparent ${ml - 1}px, #f4c7c7 ${ml - 1}px, #f4c7c7 ${ml}px, transparent ${ml}px)`,
      `linear-gradient(to bottom, #ffffff ${headerEnd}px, transparent ${headerEnd}px)`,
      `repeating-linear-gradient(to bottom, transparent 0, transparent ${ls - 1}px, #dde5ef ${ls - 1}px, #dde5ef ${ls}px)`,
    ].join(','),
    backgroundPosition: `0 0, 0 0, 0 ${offset + 1}px`,
  };
}

function InkPageImpl(props: InkPageProps) {
  const { page, zoom, tool, active } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<DrawState | EraseState | null>(null);
  const scaleRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const fingers = useRef(new Map<number, [number, number]>());
  const pan = useRef<[number, number] | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const cssW = PAGE_WIDTH * zoom;
  const cssH = PAGE_HEIGHT * zoom;

  const ctx = () => canvasRef.current?.getContext('2d', { desynchronized: true } as CanvasRenderingContext2DSettings) ?? null;

  const render = useCallback(() => {
    const c = canvasRef.current;
    const g = ctx();
    if (!c || !g) return;
    const s = scaleRef.current;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(s, 0, 0, s, 0, 0);
    const st = gesture.current;
    drawStrokes(g, st?.kind === 'erase' ? st.working : latest.current.page.strokes);
    if (st?.kind === 'draw') drawStroke(g, st.stroke);
  }, []);

  // Size backing store for zoom × devicePixelRatio, then redraw.
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (!active) {
      // Release canvas memory when the page is far from the viewport (iOS is strict about this).
      c.width = 0;
      c.height = 0;
      return;
    }
    const s = backingScale(zoom);
    const w = Math.round(PAGE_WIDTH * s);
    const h = Math.round(PAGE_HEIGHT * s);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    scaleRef.current = s;
    render();
  }, [zoom, active, render]);

  useLayoutEffect(() => {
    if (active && gesture.current?.kind !== 'erase') render();
  }, [page.strokes, active, render]);

  const scheduleRender = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      render();
    });
  };

  /* ------------------------------ eraser cursor ------------------------------ */
  const showCursor = (clientX: number, clientY: number, rect: DOMRect) => {
    const el = cursorRef.current;
    if (!el) return;
    const d = latest.current.tool.eraserSize * latest.current.zoom;
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.transform = `translate(${clientX - rect.left - d / 2}px, ${clientY - rect.top - d / 2}px)`;
    el.style.opacity = '1';
  };
  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.style.opacity = '0';
  };

  /* ------------------------------ point helpers ------------------------------ */
  const toPage = (e: { clientX: number; clientY: number }, rect: DOMRect): [number, number] => {
    const z = latest.current.zoom;
    return [(e.clientX - rect.left) / z, (e.clientY - rect.top) / z];
  };

  const addPoint = (st: DrawState, ev: PointerEvent, raw = false) => {
    const s = st.stroke;
    let [x, y] = toPage(ev, st.rect);
    st.lastRaw = [x, y];
    const n = s.x.length;
    if (n > 0 && !raw) {
      x = s.x[n - 1] + (x - s.x[n - 1]) * SMOOTHING;
      y = s.y[n - 1] + (y - s.y[n - 1]) * SMOOTHING;
    }
    if (n > 0 && Math.hypot(x - s.x[n - 1], y - s.y[n - 1]) < MIN_POINT_DISTANCE) return;
    const t = Math.round(st.epoch0 + (ev.timeStamp - st.ts0));
    s.x.push(x);
    s.y.push(y);
    s.t.push(n > 0 ? Math.max(s.t[n - 1], t) : st.epoch0);
    if (s.p) s.p.push(Math.max(0.05, Math.min(1, ev.pressure || 0.05)));
    const g = ctx();
    if (g && s.x.length >= 2) {
      g.setTransform(scaleRef.current, 0, 0, scaleRef.current, 0, 0);
      beginStrokeStyle(g, s);
      drawSegment(g, s, s.x.length - 2);
    }
  };

  const eraseAt = (st: EraseState, x: number, y: number) => {
    const { tool: t } = latest.current;
    const r = t.eraserSize / 2;
    const points = st.last ? samplePath(st.last[0], st.last[1], x, y, Math.max(2, r / 2)) : [[x, y] as [number, number]];
    st.last = [x, y];
    let changed = false;
    for (const [px, py] of points) {
      const box = { minX: px - r, minY: py - r, maxX: px + r, maxY: py + r };
      const next: Stroke[] = [];
      for (const s of st.working) {
        let b = st.boxes.get(s.id);
        if (!b) st.boxes.set(s.id, (b = strokeBBox(s)));
        if (!bboxIntersects(b, box)) {
          next.push(s);
          continue;
        }
        if (t.eraserMode === 'stroke') {
          if (strokeHitsCircle(s, px, py, r)) {
            changed = true;
            if (st.originalIds.has(s.id)) st.removed.set(s.id, s);
            else st.added.delete(s.id);
          } else next.push(s);
        } else {
          const pieces = splitStrokeByCircle(s, px, py, r);
          if (!pieces) {
            next.push(s);
            continue;
          }
          changed = true;
          if (st.originalIds.has(s.id)) st.removed.set(s.id, s);
          else st.added.delete(s.id);
          for (const piece of pieces) {
            st.added.set(piece.id, piece);
            next.push(piece);
          }
        }
      }
      st.working = next;
    }
    if (changed) scheduleRender();
  };

  /* ------------------------------ pointer events ----------------------------- */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = latest.current;
    const native = e.nativeEvent;
    const isTouch = e.pointerType === 'touch';

    if (isTouch) {
      if (!p.tool.fingerDrawing || p.penDown.current) return; // fingers scroll; palms ignored
      fingers.current.set(e.pointerId, [e.clientX, e.clientY]);
      if (fingers.current.size >= 2) {
        // Two fingers: cancel the finger stroke and pan instead.
        if (gesture.current?.kind === 'draw' && gesture.current.stroke.pointerType === 'touch') {
          gesture.current = null;
          render();
        }
        pan.current = centroid(fingers.current);
        return;
      }
    }
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 5) return;
    if (gesture.current) return; // one drawing pointer at a time

    e.preventDefault();
    // preventDefault() keeps focus where it was: blur text fields so the iPad
    // keyboard closes and shortcuts stop typing into the text panel.
    const focused = document.activeElement as HTMLElement | null;
    if (focused && (focused.tagName === 'TEXTAREA' || focused.tagName === 'INPUT' || focused.isContentEditable)) focused.blur();
    surfaceRef.current?.setPointerCapture(e.pointerId);
    if (e.pointerType === 'pen') {
      p.penDown.current = true;
      p.onPenDetected();
    }
    const rect = canvasRef.current?.getBoundingClientRect() ?? surfaceRef.current!.getBoundingClientRect();
    const erasing = p.tool.tool === 'eraser' || (e.buttons & 32) !== 0 || e.button === 5;

    if (erasing) {
      gesture.current = {
        kind: 'erase',
        pointerId: e.pointerId,
        rect,
        working: p.page.strokes.slice(),
        boxes: new Map(),
        originalIds: new Set(p.page.strokes.map((s) => s.id)),
        removed: new Map(),
        added: new Map(),
        last: null,
      };
      showCursor(e.clientX, e.clientY, rect);
      const [x, y] = toPage(e, rect);
      eraseAt(gesture.current, x, y);
      return;
    }

    const now = Date.now();
    const st: DrawState = {
      kind: 'draw',
      pointerId: e.pointerId,
      rect,
      epoch0: now,
      ts0: native.timeStamp,
      lastRaw: [0, 0],
      stroke: {
        id: createId('s_'),
        pageId: p.page.id,
        x: [],
        y: [],
        t: [],
        p: e.pointerType === 'pen' ? [] : undefined,
        color: PEN_COLORS[p.tool.color],
        width: p.tool.width,
        pointerType: e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse',
        createdAt: now,
      },
    };
    gesture.current = st;
    addPoint(st, native, true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = latest.current;
    if (e.pointerType === 'touch' && fingers.current.has(e.pointerId)) {
      fingers.current.set(e.pointerId, [e.clientX, e.clientY]);
      if (pan.current && fingers.current.size >= 2) {
        const c = centroid(fingers.current);
        p.scroller.current?.scrollBy(pan.current[0] - c[0], pan.current[1] - c[1]);
        pan.current = c;
        return;
      }
    }
    const st = gesture.current;
    if (!st) {
      if (p.tool.tool === 'eraser' && e.pointerType !== 'touch') {
        showCursor(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      }
      return;
    }
    if (st.pointerId !== e.pointerId) return;
    e.preventDefault();
    const native = e.nativeEvent;
    const events =
      typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length
        ? native.getCoalescedEvents()
        : [native];
    if (st.kind === 'draw') {
      for (const ev of events) addPoint(st, ev);
    } else {
      showCursor(e.clientX, e.clientY, st.rect);
      for (const ev of events) {
        const [x, y] = toPage(ev, st.rect);
        eraseAt(st, x, y);
      }
    }
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const p = latest.current;
    if (e.pointerType === 'touch') {
      fingers.current.delete(e.pointerId);
      if (fingers.current.size < 2) pan.current = null;
    }
    if (e.pointerType === 'pen') p.penDown.current = false;
    const st = gesture.current;
    if (!st || st.pointerId !== e.pointerId) return;
    gesture.current = null;
    try {
      surfaceRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }

    if (st.kind === 'draw') {
      const s = st.stroke;
      if (!cancelled) {
        const n = s.x.length;
        const [rx, ry] = st.lastRaw;
        if (n > 0 && Math.hypot(rx - s.x[n - 1], ry - s.y[n - 1]) >= MIN_POINT_DISTANCE) {
          s.x.push(rx);
          s.y.push(ry);
          s.t.push(s.t[n - 1]);
          if (s.p) s.p.push(s.p[n - 1]);
        }
      }
      const g = ctx();
      if (g && s.x.length >= 2) {
        g.setTransform(scaleRef.current, 0, 0, scaleRef.current, 0, 0);
        beginStrokeStyle(g, s);
        drawTail(g, s);
      }
      // iOS can fire pointercancel mid-stroke (e.g. a system gesture); keep what was drawn.
      if (s.x.length > 0) p.onAddStroke(p.page.id, s);
      else render();
    } else {
      if (p.tool.tool !== 'eraser' || e.pointerType === 'touch') hideCursor();
      if (st.removed.size || st.added.size) {
        p.onErase(p.page.id, [...st.removed.values()], [...st.added.values()]);
      } else render();
    }
  };

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const fingerMode = tool.fingerDrawing;

  return (
    <div
      ref={surfaceRef}
      data-ink-surface=""
      className="ink-surface relative shrink-0 overflow-hidden rounded-[3px] shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_18px_rgba(15,23,42,0.07)] ring-1 ring-slate-900/[0.06]"
      style={{
        width: cssW,
        height: cssH,
        touchAction: fingerMode ? 'none' : 'pan-x pan-y',
        cursor: tool.tool === 'eraser' ? 'none' : 'crosshair',
        ...paperBackground(zoom),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onPointerLeave={() => !gesture.current && hideCursor()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        width={0}
        height={0}
        className="pointer-events-none absolute inset-0"
        style={{ width: cssW, height: cssH }}
      />
      <div
        ref={cursorRef}
        className="pointer-events-none absolute left-0 top-0 rounded-full border border-slate-500/70 bg-white/40 opacity-0"
      />
    </div>
  );
}

function centroid(m: Map<number, [number, number]>): [number, number] {
  let x = 0,
    y = 0;
  for (const [px, py] of m.values()) {
    x += px;
    y += py;
  }
  return [x / m.size, y / m.size];
}

export const InkPage = memo(InkPageImpl);
