import { memo, useMemo } from 'react';
import { align } from '../../recognition/speech/evaluation';
import { useMedicineMatcher } from '../../clinical/medicineStore';
import { suggestionWarnings } from '../../clinical/suggestionSafety';

interface Props {
  text: string;
  suggestion: string;
  reason?: string;
  onApply(text: string): void;
  onDismiss(): void;
}

/** "Did you mean …?" card for a sentence the sentence check thinks was misheard. */
function SentenceSuggestionImpl({ text, suggestion, reason, onApply, onDismiss }: Props) {
  const matcher = useMedicineMatcher();
  const warnings = useMemo(() => suggestionWarnings(text, suggestion, matcher), [text, suggestion, matcher]);
  const ops = useMemo(() => {
    const tok = (s: string) => s.split(/\s+/).filter(Boolean);
    // Compare case-insensitively but display the suggestion's own words.
    const a = tok(text),
      b = tok(suggestion);
    const { ops } = align(a.map((w) => w.toLowerCase()), b.map((w) => w.toLowerCase()));
    let j = 0;
    return ops.map((o) => {
      if (o.op === 'del') return { op: o.op, word: a.find((w) => w.toLowerCase() === o.ref) ?? o.ref ?? '' };
      const word = b[j++] ?? o.hyp ?? '';
      return { op: o.op, word };
    });
  }, [text, suggestion]);

  return (
    <div className="mt-1 mb-1.5 ml-12 rounded-lg bg-blue-50 px-2.5 py-2 text-[13px] text-blue-950 ring-1 ring-blue-200 ring-inset" data-testid="sentence-suggestion">
      <div className="text-[11.5px] font-medium text-blue-800">Possibly misheard — did you mean:</div>
      <p className="speech-text mt-0.5 leading-relaxed">
        {ops.map((o, i) =>
          o.op === 'del' ? null : (
            <span key={i} className={o.op === 'ok' ? '' : 'rounded bg-blue-200/70 px-0.5 font-semibold'}>
              {o.word}{' '}
            </span>
          ),
        )}
      </p>
      {reason && <p className="mt-0.5 text-[11.5px] text-blue-800/80">{reason}</p>}
      {warnings.length > 0 && (
        <p className="mt-1 rounded bg-amber-100 px-1.5 py-0.5 text-[12px] font-medium text-amber-900">
          ⚠ This suggestion {warnings.join(' and ')} — check carefully before applying.
        </p>
      )}
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={() => onApply(suggestion)}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-[12.5px] font-medium text-white hover:bg-blue-700"
        >
          Use suggestion
        </button>
        <button type="button" onClick={onDismiss} className="rounded-md px-2.5 py-1 text-[12.5px] font-medium text-blue-800 hover:bg-blue-100">
          Keep as is
        </button>
      </div>
    </div>
  );
}

export const SentenceSuggestion = memo(SentenceSuggestionImpl);
