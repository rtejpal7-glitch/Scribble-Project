import { PEN_COLORS, PEN_WIDTHS, type PenColor, type ToolState } from '../../types/handwriting';

interface Props {
  tool: ToolState;
  onChange(patch: Partial<ToolState>): void;
}

const COLOR_LABELS: Record<PenColor, string> = { black: 'Black', blue: 'Blue', red: 'Red', green: 'Green' };

export function PenSettings({ tool, onChange }: Props) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Pen settings">
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => {
        const selected = tool.color === c;
        return (
          <button
            key={c}
            type="button"
            aria-label={`${COLOR_LABELS[c]} pen`}
            title={COLOR_LABELS[c]}
            aria-pressed={selected}
            onClick={() => onChange({ color: c, tool: 'pen' })}
            className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100"
          >
            <span
              className="block h-[18px] w-[18px] rounded-full transition-shadow"
              style={{
                backgroundColor: PEN_COLORS[c],
                boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 3.5px ${PEN_COLORS[c]}` : 'inset 0 0 0 1px rgba(0,0,0,.08)',
              }}
            />
          </button>
        );
      })}
      <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" aria-hidden="true" />
      {PEN_WIDTHS.map((w, i) => {
        const selected = Math.abs(tool.width - w) < 0.01;
        return (
          <button
            key={w}
            type="button"
            aria-label={`Pen thickness ${i + 1}`}
            title={['Fine', 'Medium', 'Bold', 'Marker'][i]}
            aria-pressed={selected}
            onClick={() => onChange({ width: w, tool: 'pen' })}
            className={`flex h-9 w-8 shrink-0 items-center justify-center rounded-lg ${
              selected ? 'bg-slate-200/80' : 'hover:bg-slate-100'
            }`}
          >
            <span
              className="block rounded-full"
              style={{ width: 4 + w * 1.6, height: 4 + w * 1.6, backgroundColor: PEN_COLORS[tool.color] }}
            />
          </button>
        );
      })}
    </div>
  );
}
