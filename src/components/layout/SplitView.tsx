import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

interface Props {
  first: ReactNode;
  second: ReactNode;
  orientation: 'horizontal' | 'vertical';
  showSecond: boolean;
  storageKey?: string;
  defaultRatio?: number;
}

function readRatio(key: string | undefined, fallback: number) {
  if (!key) return fallback;
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0.15 && v < 0.85 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Two panels with a draggable divider (side-by-side or stacked). */
export function SplitView({ first, second, orientation, showSecond, storageKey, defaultRatio = 0.62 }: Props) {
  const key = storageKey ? `${storageKey}:${orientation}` : undefined;
  const [ratio, setRatio] = useState(() => readRatio(key, defaultRatio));
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const horizontal = orientation === 'horizontal';

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !root.current) return;
    const r = root.current.getBoundingClientRect();
    const v = horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    setRatio(Math.min(0.82, Math.max(0.25, v)));
  };
  const onUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (key)
      try {
        localStorage.setItem(key, String(ratio));
      } catch {
        /* ignore */
      }
  };

  const firstBasis = showSecond ? `${ratio * 100}%` : '100%';

  return (
    <div ref={root} className={`flex h-full min-h-0 w-full min-w-0 ${horizontal ? 'flex-row' : 'flex-col'}`}>
      <div className="relative min-h-0 min-w-0" style={{ flex: `0 0 ${firstBasis}` }}>
        {first}
      </div>
      {showSecond && (
        <>
          <div
            role="separator"
            aria-orientation={horizontal ? 'vertical' : 'horizontal'}
            aria-label="Resize panels"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={() => setRatio(defaultRatio)}
            className={`group relative z-10 shrink-0 touch-none bg-slate-200 ${
              horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
            }`}
          >
            <div className={`absolute ${horizontal ? '-inset-x-2.5 inset-y-0' : '-inset-y-2.5 inset-x-0'}`} />
            <div
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 transition-colors group-hover:bg-slate-400 ${
                dragging ? 'bg-blue-500' : ''
              } ${horizontal ? 'h-10 w-1.5' : 'h-1.5 w-10'}`}
            />
          </div>
          <div className="relative min-h-0 min-w-0 flex-1">{second}</div>
        </>
      )}
    </div>
  );
}
