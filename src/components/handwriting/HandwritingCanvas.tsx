import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PageData } from '../../types/document';
import { PAGE_WIDTH, type Stroke, type ToolState } from '../../types/handwriting';
import { InkPage } from './InkPage';
import { PlusIcon } from '../common/icons';

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 3;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

export interface ZoomAnchor {
  /** Point in scroller viewport coordinates that should stay fixed. */
  x: number;
  y: number;
}

export interface HandwritingCanvasProps {
  pages: PageData[];
  zoom: number;
  tool: ToolState;
  onZoomChange(zoom: number, anchor?: ZoomAnchor): void;
  onAddStroke(pageId: string, stroke: Stroke): void;
  onErase(pageId: string, removed: Stroke[], added: Stroke[]): void;
  onAddPage(): void;
  onCurrentPageChange(index: number): void;
  onPenDetected(): void;
  onInkStart?(): void;
  /** Change `nonce` to scroll to a page. */
  scrollRequest: { index: number; nonce: number } | null;
  /** Change to fit the page width to the panel. */
  fitWidthNonce: number;
}

const PAGE_GAP = 28;
const PADDING = 24;

/**
 * Continuous-scroll notebook: pages stacked vertically, native finger scrolling,
 * pen/mouse drawing. Only pages near the viewport get a canvas backing store.
 */
export function HandwritingCanvas(props: HandwritingCanvasProps) {
  const { pages, zoom, tool } = props;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pageEls = useRef(new Map<string, HTMLDivElement>());
  const penDown = useRef(false);
  const [activePages, setActivePages] = useState<Set<string>>(() => new Set(pages.slice(0, 2).map((p) => p.id)));
  const pendingAnchor = useRef<{ anchor: ZoomAnchor; from: number } | null>(null);
  const latest = useRef(props);
  latest.current = props;

  /* ------------------------- virtualisation of canvases ------------------------- */
  const pageKey = pages.map((p) => p.id).join(',');
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setActivePages((prev) => {
          const next = new Set(prev);
          for (const en of entries) {
            const id = (en.target as HTMLElement).dataset.pageId!;
            if (en.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
        });
      },
      { root, rootMargin: '900px 0px' },
    );
    pageEls.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pageKey]);

  /* ------------------------------ current page ------------------------------ */
  const reportCurrent = useCallback(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const mid = root.scrollTop + root.clientHeight / 2;
    let best = 0;
    let bestD = Infinity;
    latest.current.pages.forEach((p, i) => {
      const el = pageEls.current.get(p.id);
      if (!el) return;
      const c = el.offsetTop + el.offsetHeight / 2;
      const d = Math.abs(c - mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    latest.current.onCurrentPageChange(best);
  }, []);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        reportCurrent();
      });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [reportCurrent]);

  useEffect(() => {
    const req = props.scrollRequest;
    const root = scrollerRef.current;
    if (!req || !root) return;
    const page = latest.current.pages[req.index];
    const el = page && pageEls.current.get(page.id);
    if (el) root.scrollTo({ top: el.offsetTop - PADDING, behavior: 'smooth' });
  }, [props.scrollRequest]);

  /* ------------------------------ zoom handling ------------------------------ */
  const requestZoom = useCallback((z: number, anchor?: ZoomAnchor) => {
    const root = scrollerRef.current;
    const next = clampZoom(z);
    if (!root || next === latest.current.zoom) return;
    const a = anchor ?? { x: root.clientWidth / 2, y: root.clientHeight / 2 };
    pendingAnchor.current = { anchor: a, from: latest.current.zoom };
    latest.current.onZoomChange(next, a);
  }, []);

  // Keep the anchor point fixed when zoom changes (from any source).
  useLayoutEffect(() => {
    const root = scrollerRef.current;
    const pending = pendingAnchor.current;
    pendingAnchor.current = null;
    if (!root || !pending || pending.from === zoom) return;
    const r = zoom / pending.from;
    const { x, y } = pending.anchor;
    root.scrollLeft = (root.scrollLeft + x) * r - x;
    root.scrollTop = (root.scrollTop + y) * r - y;
  }, [zoom]);

  // External zoom changes (toolbar) arrive without an anchor: register one first.
  const prevZoom = useRef(zoom);
  if (prevZoom.current !== zoom) {
    if (!pendingAnchor.current && scrollerRef.current) {
      const root = scrollerRef.current;
      pendingAnchor.current = { anchor: { x: root.clientWidth / 2, y: root.clientHeight / 2 }, from: prevZoom.current };
    }
    prevZoom.current = zoom;
  }

  // Fit width on request and on first mount if the page is wider than the panel.
  const fitWidth = useCallback(
    (onlyShrink: boolean) => {
      const root = scrollerRef.current;
      if (!root || root.clientWidth === 0) return;
      const fit = clampZoom((root.clientWidth - PADDING * 2) / PAGE_WIDTH);
      if (onlyShrink && fit >= latest.current.zoom) return;
      requestZoom(fit);
    },
    [requestZoom],
  );
  useEffect(() => {
    fitWidth(true);
    // If the editor starts hidden (another tab is shown), fit once it becomes visible.
    const root = scrollerRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    let fitted = root.clientWidth > 0;
    const ro = new ResizeObserver(() => {
      if (!fitted && root.clientWidth > 0) {
        fitted = true;
        fitWidth(true);
      }
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [fitWidth]);
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) {
      firstFit.current = false;
      return;
    }
    fitWidth(false);
  }, [props.fitWidthNonce, fitWidth]);

  // Pinch (Safari gesture events), ctrl+wheel (trackpad pinch on desktop), stylus/palm handling.
  useEffect(() => {
    const root = scrollerRef.current;
    const content = contentRef.current;
    if (!root || !content) return;

    let startZoom = 1;
    let scale = 1;
    let origin: ZoomAnchor = { x: 0, y: 0 };
    type GestureLike = Event & { scale: number; clientX: number; clientY: number };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (penDown.current) return;
      const g = e as GestureLike;
      const rect = root.getBoundingClientRect();
      startZoom = latest.current.zoom;
      scale = 1;
      origin = { x: g.clientX - rect.left, y: g.clientY - rect.top };
      content.style.transformOrigin = `${root.scrollLeft + origin.x}px ${root.scrollTop + origin.y}px`;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (penDown.current) return;
      const g = e as GestureLike;
      scale = clampZoom(startZoom * g.scale) / startZoom;
      content.style.transform = `scale(${scale})`;
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      content.style.transform = '';
      if (scale !== 1) requestZoom(startZoom * scale, origin);
      scale = 1;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      requestZoom(latest.current.zoom * Math.exp(-e.deltaY * 0.01), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    // iPadOS: stop Apple Pencil from scrolling (it reports touchType "stylus"),
    // and stop palms from scrolling while the pen is down. Fingers still scroll.
    const onTouch = (e: TouchEvent) => {
      const onSurface = (e.target as Element | null)?.closest?.('[data-ink-surface]');
      if (!onSurface) return;
      let stylus = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i] as Touch & { touchType?: string };
        if (t.touchType === 'stylus') stylus = true;
      }
      if (stylus || penDown.current || latest.current.tool.fingerDrawing) {
        if (e.cancelable) e.preventDefault();
      }
    };

    root.addEventListener('gesturestart', onGestureStart, { passive: false });
    root.addEventListener('gesturechange', onGestureChange, { passive: false });
    root.addEventListener('gestureend', onGestureEnd, { passive: false });
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchstart', onTouch, { passive: false });
    root.addEventListener('touchmove', onTouch, { passive: false });
    return () => {
      root.removeEventListener('gesturestart', onGestureStart);
      root.removeEventListener('gesturechange', onGestureChange);
      root.removeEventListener('gestureend', onGestureEnd);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchstart', onTouch);
      root.removeEventListener('touchmove', onTouch);
    };
  }, [requestZoom]);

  const setPageEl = (id: string) => (el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(id, el);
    else pageEls.current.delete(id);
  };

  return (
    <div
      ref={scrollerRef}
      className="ink-scroller relative h-full w-full overflow-auto overscroll-contain bg-[#eceef1]"
      data-testid="ink-scroller"
    >
      <div
        ref={contentRef}
        className="mx-auto flex w-fit flex-col items-center"
        style={{ padding: PADDING, gap: PAGE_GAP, willChange: 'transform' }}
      >
        {pages.map((page, i) => (
          <div key={page.id} ref={setPageEl(page.id)} data-page-id={page.id} className="flex flex-col items-center">
            <InkPage
              page={page}
              index={i}
              zoom={zoom}
              tool={tool}
              active={activePages.has(page.id)}
              scroller={scrollerRef}
              penDown={penDown}
              onAddStroke={props.onAddStroke}
              onErase={props.onErase}
              onPenDetected={props.onPenDetected}
              onInkStart={props.onInkStart}
            />
            <div className="mt-2 text-[11px] font-medium tracking-wide text-slate-400">
              Page {i + 1} of {pages.length}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={props.onAddPage}
          className="mb-6 flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm text-slate-500 transition-colors hover:border-slate-400 hover:bg-white/60 hover:text-slate-700"
        >
          <PlusIcon size={16} /> Add page
        </button>
      </div>
    </div>
  );
}
