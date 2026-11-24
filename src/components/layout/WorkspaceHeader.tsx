import { useEffect, useState, type ReactNode } from 'react';
import { NotebookIcon, PlusIcon } from '../common/icons';

interface Props {
  title: string;
  documentsLabel: string;
  newLabel?: string;
  onOpenDocuments(): void;
  onNewDocument(): void;
  onRename(title: string): void;
  right?: ReactNode;
}

/** Per-workspace document bar: document list, editable title, new document. */
export function WorkspaceHeader({ title, documentsLabel, newLabel = 'New', onOpenDocuments, onNewDocument, onRename, right }: Props) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const commit = () => {
    const t = draft.trim();
    if (t && t !== title) onRename(t);
    else setDraft(title);
  };
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 sm:px-3">
      <button
        type="button"
        onClick={onOpenDocuments}
        className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-100"
        aria-label={`Open ${documentsLabel.toLowerCase()}`}
      >
        <NotebookIcon /> <span className="hidden sm:inline">{documentsLabel}</span>
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
      {right}
      <button
        type="button"
        onClick={onNewDocument}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100"
      >
        <PlusIcon size={16} /> <span className="hidden sm:inline">{newLabel}</span>
      </button>
    </div>
  );
}
