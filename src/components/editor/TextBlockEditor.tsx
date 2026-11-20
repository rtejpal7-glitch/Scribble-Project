import { memo, useLayoutEffect, useRef } from 'react';
import type { TextBlock } from '../../types/document';
import { UndoIcon } from '../common/icons';

interface Props {
  block: TextBlock;
  onChange(blockId: string, value: string): void;
  onRevert(blockId: string): void;
  onResolveConflict(blockId: string, choice: 'keep-mine' | 'use-new'): void;
}

function AutoTextarea({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string;
  onChange(v: string): void;
  className?: string;
  'aria-label'?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      className={`block w-full resize-none overflow-hidden bg-transparent outline-none ${className ?? ''}`}
      {...rest}
    />
  );
}

/** One recognised line. Editing it stores a manual correction bound to the line's strokes. */
function TextBlockEditorImpl({ block, onChange, onRevert, onResolveConflict }: Props) {
  const edited = block.correctedText !== null;
  const value = block.correctedText ?? block.recognizedText;
  return (
    <div className={block.paragraphStart ? 'mt-3 first:mt-0' : ''} data-block-id={block.id}>
      <div
        className={`group relative rounded-md border-l-2 pl-2.5 pr-8 transition-colors focus-within:bg-blue-50/40 hover:bg-slate-50 ${
          edited ? 'border-amber-400' : block.conflict ? 'border-orange-400' : 'border-transparent'
        }`}
      >
        <AutoTextarea
          value={value}
          onChange={(v) => onChange(block.id, v)}
          aria-label={edited ? 'Edited line' : 'Recognised line'}
          className="py-[3px] text-[15px] leading-[1.6] text-slate-800"
        />
        {edited && (
          <button
            type="button"
            onClick={() => onRevert(block.id)}
            title={`Revert to recognised text: “${block.recognizedText}”`}
            aria-label="Revert to recognised text"
            className="absolute right-1 top-1 rounded p-1 text-amber-600 opacity-70 hover:bg-amber-50 hover:opacity-100"
          >
            <UndoIcon size={14} />
          </button>
        )}
      </div>
      {block.conflict && (
        <div className="mt-1 ml-2.5 rounded-md bg-orange-50 px-2.5 py-2 text-[12.5px] leading-snug text-orange-900 ring-1 ring-orange-200 ring-inset">
          The handwriting for this line changed after you edited it. Your edit was{' '}
          <span className="font-medium">“{block.conflict.previousCorrection}”</span>.
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              className="rounded bg-white px-2 py-1 font-medium ring-1 ring-orange-300 hover:bg-orange-100"
              onClick={() => onResolveConflict(block.id, 'keep-mine')}
            >
              Restore my edit
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 font-medium hover:bg-orange-100"
              onClick={() => onResolveConflict(block.id, 'use-new')}
            >
              Use new text
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const TextBlockEditor = memo(TextBlockEditorImpl);
export { AutoTextarea };
