import { ERASER_SIZES, type ToolState } from '../../types/handwriting';

interface Props {
  tool: ToolState;
  onChange(patch: Partial<ToolState>): void;
}

export function EraserTool({ tool, onChange }: Props) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Eraser settings">
      <div className="flex rounded-lg bg-slate-100 p-0.5 text-[12.5px] font-medium">
        {(
          [
            ['stroke', 'Whole stroke', 'Erase entire strokes you touch'],
            ['partial', 'Precise', 'Erase only the part under the eraser'],
          ] as const
        ).map(([mode, label, hint]) => (
          <button
            key={mode}
            type="button"
            title={hint}
            aria-pressed={tool.eraserMode === mode}
            onClick={() => onChange({ eraserMode: mode, tool: 'eraser' })}
            className={`h-8 rounded-md px-2.5 whitespace-nowrap transition-colors ${
              tool.eraserMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" aria-hidden="true" />
      {ERASER_SIZES.map((size, i) => {
        const selected = tool.eraserSize === size;
        return (
          <button
            key={size}
            type="button"
            aria-label={`Eraser size ${['small', 'medium', 'large'][i]}`}
            title={['Small', 'Medium', 'Large'][i]}
            aria-pressed={selected}
            onClick={() => onChange({ eraserSize: size, tool: 'eraser' })}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              selected ? 'bg-slate-200/80' : 'hover:bg-slate-100'
            }`}
          >
            <span className="block rounded-full border-[1.5px] border-slate-500" style={{ width: 6 + i * 6, height: 6 + i * 6 }} />
          </button>
        );
      })}
    </div>
  );
}
