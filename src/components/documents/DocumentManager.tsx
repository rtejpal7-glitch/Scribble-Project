import { useEffect, useState } from 'react';
import type { DocumentSummary } from '../../types/document';
import { useConfirm } from '../common/ConfirmDialog';
import { PencilLineIcon, PlusIcon, TrashIcon, XIcon } from '../common/icons';
import { Spinner } from '../editor/RecognitionStatus';

/** Anything that can list and delete documents (handwriting or voice storage). */
export interface DocumentListSource {
  listDocuments(): Promise<DocumentSummary[]>;
  deleteDocument(id: string): Promise<void>;
}

interface Props {
  open: boolean;
  storage: DocumentListSource;
  heading?: string;
  /** Describes the count shown per document (pages / recordings). */
  countLabel?: (n: number) => string;
  footer?: string;
  currentId: string;
  refreshKey: number;
  onClose(): void;
  onOpenDocument(id: string): void;
  onCreateDocument(): void;
  onRename(id: string, title: string): Promise<void>;
  onDeleted(id: string, remaining: DocumentSummary[]): void;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const pagesLabel = (n: number) => `${n} page${n === 1 ? '' : 's'}`;

/** Document list drawer: create, open, rename, delete (with confirmation). Shared by both workspaces. */
export function DocumentManager(p: Props) {
  const countLabel = p.countLabel ?? pagesLabel;
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const confirm = useConfirm();

  const reload = () =>
    p.storage
      .listDocuments()
      .then((d) => {
        setDocs(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    if (p.open) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, p.refreshKey]);

  const commitRename = async (id: string) => {
    const title = draft.trim();
    setRenaming(null);
    if (!title) return;
    await p.onRename(id, title);
    await reload();
  };

  const remove = async (d: DocumentSummary) => {
    const ok = await confirm({
      title: `Delete “${d.title}”?`,
      message: `“${d.title}” (${countLabel(d.pageCount)}) and all its content will be permanently deleted from this device.`,
      confirmLabel: 'Delete document',
      destructive: true,
    });
    if (!ok) return;
    await p.storage.deleteDocument(d.id);
    const remaining = await p.storage.listDocuments();
    setDocs(remaining);
    p.onDeleted(d.id, remaining);
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/20 transition-opacity ${p.open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={p.onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[340px] max-w-[88vw] flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 ${
          p.open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label={p.heading ?? "Documents"}
        aria-hidden={!p.open}
      >
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <h2 className="flex-1 text-[15px] font-semibold text-slate-900">{p.heading ?? 'Notebooks'}</h2>
          <button className="btn-primary h-8 px-3 text-[13px]" onClick={p.onCreateDocument}>
            <PlusIcon size={15} /> New
          </button>
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={p.onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && <p className="p-3 text-sm text-red-700">Could not load documents: {error}</p>}
          {!docs && !error && (
            <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
              <Spinner /> Loading…
            </div>
          )}
          {docs?.length === 0 && <p className="p-4 text-sm text-slate-500">No documents yet.</p>}
          <ul className="space-y-0.5">
            {docs?.map((d) => {
              const current = d.id === p.currentId;
              return (
                <li key={d.id}>
                  <div
                    className={`group flex items-start gap-2 rounded-lg px-3 py-2.5 ${current ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                  >
                    {renaming === d.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => void commitRename(d.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(d.id);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-[14px] outline-none focus:border-blue-500"
                        aria-label="Document title"
                      />
                    ) : (
                      <button className="min-w-0 flex-1 text-left" onClick={() => p.onOpenDocument(d.id)}>
                        <div className="truncate text-[14px] font-medium text-slate-900">{d.title}</div>
                        <div className="mt-0.5 text-[12px] text-slate-500">
                          {formatDate(d.updatedAt)} · {countLabel(d.pageCount)}
                        </div>
                        {d.preview && <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-slate-400">{d.preview}</div>}
                      </button>
                    )}
                    <div className="flex shrink-0 gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                      <button
                        className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"
                        aria-label={`Rename ${d.title}`}
                        title="Rename"
                        onClick={() => {
                          setDraft(d.title);
                          setRenaming(d.id);
                        }}
                      >
                        <PencilLineIcon size={15} />
                      </button>
                      <button
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${d.title}`}
                        title="Delete"
                        onClick={() => void remove(d)}
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="border-t border-slate-200 px-4 py-3 text-[11.5px] leading-relaxed text-slate-400">
          {p.footer ?? 'Documents are stored on this device (IndexedDB). Add the app to your Home Screen to keep Safari from clearing them.'}
        </p>
      </aside>
    </>
  );
}
