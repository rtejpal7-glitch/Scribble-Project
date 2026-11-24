import type { ReactNode } from 'react';

export type WorkspaceId = 'voice' | 'handwriting';

interface Props {
  active: WorkspaceId;
  onChange(id: WorkspaceId): void;
  /** Small indicator (e.g. recording dot) per tab. */
  badges?: Partial<Record<WorkspaceId, ReactNode>>;
}

const TABS: Array<{ id: WorkspaceId; label: string; icon: ReactNode }> = [
  {
    id: 'voice',
    label: 'Voice to Text',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
        <path d="M12 18v4" />
      </svg>
    ),
  },
  {
    id: 'handwriting',
    label: 'Handwriting to Text',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
];

/** Segmented control switching between the two input workspaces. */
export function WorkspaceTabs({ active, onChange, badges }: Props) {
  return (
    <div role="tablist" aria-label="Input workspace" className="inline-flex rounded-xl bg-slate-100 p-1">
      {TABS.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`relative inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors sm:px-4 ${
              selected ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.icon}
            <span className="hidden min-[420px]:inline">{t.label}</span>
            <span className="min-[420px]:hidden">{t.id === 'voice' ? 'Voice' : 'Handwriting'}</span>
            {badges?.[t.id]}
          </button>
        );
      })}
    </div>
  );
}
