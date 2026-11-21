import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { TextBlock } from '../../types/document';
import { SparklesIcon, UndoIcon } from '../common/icons';
import { replaceWord } from '../../sync/textSync';

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
/**
 * Tap-to-fix: lists the line's words; tapping one shows the recogniser's
 * alternative readings (e.g. "clays" → "days"). Works without opening the
 * on-screen keyboard, which matters on iPad.
 */
function Alternatives({ block, onPick }: { block: TextBlock; onPick(text: string): void }) {
  const [selected, setSelected] = useState<number | null>(() => {
    const i = block.words?.findIndex((w) => w.alternatives.length > 0) ?? -1;
    return i >= 0 ? i : null;
  });
  const words = block.words ?? [];
  const current = selected !== null ? words[selected] : null;
  return (
    <div className="mt-1 mb-1 ml-2.5 rounded-md bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200 ring-inset" data-testid="alternatives">
      <div className="mb-1 text-[11px] font-medium text-slate-500">Tap a word to see other readings</div>
      <div className="flex flex-wrap gap-1">
        {words.map((w, i) => (
          <button
            key={i}
            type="button"
            disabled={w.alternatives.length === 0}
            onClick={() => setSelected(i)}
            className={`rounded px-1.5 py-0.5 text-[13.5px] ${
              selected === i
                ? 'bg-slate-900 text-white'
                : w.alternatives.length
                  ? 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-100'
                  : 'text-slate-400'
            }`}
          >
            {w.text}
          </button>
        ))}
      </div>
      {current && current.alternatives.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-200 pt-2">
          <span className="mr-1 text-[11.5px] text-slate-500">Replace “{current.text}” with</span>
          {current.alternatives.map((alt) => (
            <button
              key={alt}
              type="button"
              onClick={() => onPick(replaceWord(words, selected!, alt))}
              className="rounded bg-blue-50 px-1.5 py-0.5 text-[13.5px] font-medium text-blue-800 ring-1 ring-blue-200 hover:bg-blue-100"
            >
              {alt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TextBlockEditorImpl({ block, onChange, onRevert, onResolveConflict }: Props) {
  const edited = block.correctedText !== null;
  const value = block.correctedText ?? block.recognizedText;
  const [showAlternatives, setShowAlternatives] = useState(false);
  const hasAlternatives = !edited && !block.conflict && !!block.words?.some((w) => w.alternatives.length > 0);
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
        {hasAlternatives && (
          <button
            type="button"
            onClick={() => setShowAlternatives((v) => !v)}
            title="Other readings for this line"
            aria-label="Show other readings for this line"
            aria-expanded={showAlternatives}
            className={`absolute right-1 top-1 rounded p-1 hover:bg-slate-100 hover:text-slate-700 ${
              showAlternatives ? 'bg-slate-100 text-slate-700' : 'text-slate-400'
            }`}
          >
            <SparklesIcon size={14} />
          </button>
        )}
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
      {hasAlternatives && showAlternatives && (
        <Alternatives
          block={block}
          onPick={(text) => {
            onChange(block.id, text);
            setShowAlternatives(false);
          }}
        />
      )}
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
