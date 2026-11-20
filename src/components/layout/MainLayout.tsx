import { useEffect, useState, type ReactNode } from 'react';
import { NotebookIcon, PlusIcon } from '../common/icons';

interface Props {
  title: string;
  hidden: boolean;
  onOpenDocuments(): void;
  onNewDocument(): void;
  onRename(title: string): void;
  children: ReactNode;
}

/** Standalone-app chrome around the editor (not part of the reusable module). */
export function MainLayout({ title, hidden, onOpenDocuments, onNewDocument, onRename, children }: Props) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const commit = () => {
    const t = draft.trim();
    if (t && t !== title) onRename(t);
    else setDraft(title);
  };
  return (
    <div className="app-shell flex h-full flex-col bg-white">
      {!hidden && (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 pt-[env(safe-area-inset-top)] sm:px-3">
          <button
            type="button"
            onClick={onOpenDocuments}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-100"
            aria-label="Open notebooks"
          >
            <NotebookIcon /> <span className="hidden sm:inline">Notebooks</span>
          </button>
          <div className="h-5 w-px bg-slate-200" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDraft(title);
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Document title"
            className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-[15px] font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-blue-500"
          />
          <button
            type="button"
            onClick={onNewDocument}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100"
          >
            <PlusIcon size={16} /> <span className="hidden sm:inline">New</span>
          </button>
          <span className="hidden pr-1 text-[13px] font-semibold tracking-tight text-slate-400 md:inline">InkFlow</span>
        </header>
      )}
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
