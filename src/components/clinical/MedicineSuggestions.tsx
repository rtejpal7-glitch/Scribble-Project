import { memo, useMemo } from 'react';
import { applyMedicineFix } from '../../clinical/medicineMatcher';
import { medicineStore, useMedicineMatcher } from '../../clinical/medicineStore';

interface Props {
  text: string;
  onReplace(text: string): void;
  className?: string;
}

export const PillIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
    <path d="m8.5 8.5 7 7" />
  </svg>
);

/**
 * "Medicine name?" row under a line of recognised text. Each fix needs a tap
 * (sound-alike drugs make silent changes unsafe). "Not a medicine" stops the
 * word from being flagged again.
 */
function MedicineSuggestionsImpl({ text, onReplace, className = '' }: Props) {
  const matcher = useMedicineMatcher();
  const issues = useMemo(() => matcher.check(text), [matcher, text]);
  if (!issues.length) return null;
  return (
    <div className={`flex flex-col gap-1 ${className}`} data-testid="medicine-suggestions">
      {issues.map((issue) => (
        <div
          key={`${issue.start}-${issue.found}`}
          className="flex flex-wrap items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[12.5px] text-emerald-900 ring-1 ring-emerald-200 ring-inset"
        >
          <PillIcon />
          <span>
            Medicine name? <span className="font-medium">“{issue.found}”</span> →
          </span>
          {issue.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onReplace(applyMedicineFix(text, issue, s))}
              className="rounded bg-white px-1.5 py-0.5 font-medium text-emerald-800 ring-1 ring-emerald-300 hover:bg-emerald-100"
              title={`Replace with ${s}`}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            onClick={() => medicineStore.allow(issue.found)}
            className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-emerald-700 hover:bg-emerald-100"
            title="Don't flag this word again"
          >
            Not a medicine
          </button>
        </div>
      ))}
    </div>
  );
}

export const MedicineSuggestions = memo(MedicineSuggestionsImpl);
