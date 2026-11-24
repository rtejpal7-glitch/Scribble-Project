import { SPEECH_LANGUAGES, type SpeechLanguage } from '../../types/speech';
import type { LanguageSupport } from '../../recognition/speech/SpeechRecognitionProvider';

interface Props {
  value: SpeechLanguage;
  onChange(language: SpeechLanguage): void;
  disabled?: boolean;
  support?: Record<SpeechLanguage, LanguageSupport>;
}

export function LanguageSelector({ value, onChange, disabled, support }: Props) {
  const current = SPEECH_LANGUAGES.find((l) => l.id === value)!;
  const level = support?.[value];
  return (
    <div>
      <div className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">Language</div>
      <div role="radiogroup" aria-label="Dictation language" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {SPEECH_LANGUAGES.map((l) => {
          const selected = l.id === value;
          const s = support?.[l.id];
          return (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || s === 'unsupported'}
              onClick={() => onChange(l.id)}
              title={l.label}
              className={`relative h-10 rounded-lg px-1 text-[13.5px] font-medium transition-colors disabled:opacity-40 ${
                selected ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {l.short}
              {s === 'approximate' && <span className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="approximate" />}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-slate-500">
        {current.label}: {current.description}.
      </p>
      {level === 'approximate' && (
        <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[12px] leading-snug text-amber-900 ring-1 ring-amber-200 ring-inset">
          The browser engine can't follow Hindi–English switching. Hinglish runs through its Hindi recogniser, so English
          words may come out in Devanagari or be misheard. Use the self-hosted engine for real Hinglish support.
        </p>
      )}
    </div>
  );
}
