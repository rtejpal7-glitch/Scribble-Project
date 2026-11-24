import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HandwritingEditor, type EditorStatus, type HandwritingEditorHandle } from '../../handwriting-module';
import { IndexedDBStorage } from '../../storage/IndexedDBStorage';
import { WorkspaceHeader } from '../layout/WorkspaceHeader';
import { DocumentManager } from '../documents/DocumentManager';
import { createDocument } from '../../state/documentModel';
import { Spinner } from '../editor/RecognitionStatus';
import type { DocumentSummary } from '../../types/document';

const LAST_DOC_KEY = 'inkflow:lastDocument';

interface Props {
  onFocusModeChange?(focus: boolean): void;
}

/**
 * Standalone-app wrapper around the reusable HandwritingEditor: picks the
 * notebook to open and provides the document list. (Unchanged behaviour from
 * the original single-workspace app.)
 */
export function HandwritingWorkspace({ onFocusModeChange }: Props) {
  const storage = useMemo(() => new IndexedDBStorage(), []);
  const [docId, setDocId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [focus, setFocus] = useState(false);
  const [title, setTitle] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const editor = useRef<HandwritingEditorHandle>(null);

  useEffect(() => {
    (async () => {
      const docs = await storage.listDocuments();
      const last = localStorage.getItem(LAST_DOC_KEY);
      if (last && docs.some((d) => d.id === last)) return setDocId(last);
      if (docs[0]) return setDocId(docs[0].id);
      const doc = createDocument();
      await storage.saveDocument(doc);
      setDocId(doc.id);
    })().catch((e: unknown) => setBootError(e instanceof Error ? e.message : String(e)));
  }, [storage]);

  useEffect(() => {
    if (docId) localStorage.setItem(LAST_DOC_KEY, docId);
  }, [docId]);

  const openDocument = useCallback(async (id: string) => {
    await editor.current?.flush();
    setDocId(id);
    setDrawer(false);
  }, []);

  const newDocument = useCallback(async () => {
    await editor.current?.flush();
    const doc = createDocument();
    await storage.saveDocument(doc);
    setDocId(doc.id);
    setDrawer(false);
    setRefreshKey((k) => k + 1);
  }, [storage]);

  const rename = useCallback(
    async (id: string, newTitle: string) => {
      if (id === docId) {
        editor.current?.setTitle(newTitle);
        await new Promise((r) => setTimeout(r, 0));
        await editor.current?.flush();
      } else {
        const doc = await storage.loadDocument(id);
        if (doc) await storage.saveDocument({ ...doc, title: newTitle, updatedAt: Date.now() });
      }
      setRefreshKey((k) => k + 1);
    },
    [docId, storage],
  );

  const onDeleted = useCallback(
    async (id: string, remaining: DocumentSummary[]) => {
      if (id !== docId) return;
      if (remaining[0]) setDocId(remaining[0].id);
      else {
        const doc = createDocument();
        await storage.saveDocument(doc);
        setDocId(doc.id);
        setRefreshKey((k) => k + 1);
      }
    },
    [docId, storage],
  );

  const onStatus = useCallback((s: EditorStatus) => setTitle(s.title), []);
  const onSave = useCallback(() => setRefreshKey((k) => k + 1), []);
  const onFocus = useCallback(
    (f: boolean) => {
      setFocus(f);
      onFocusModeChange?.(f);
    },
    [onFocusModeChange],
  );

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-red-700">
        Local storage is unavailable: {bootError}. Private browsing modes can block IndexedDB.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {!focus && (
        <WorkspaceHeader
          title={title}
          documentsLabel="Notebooks"
          onOpenDocuments={() => setDrawer(true)}
          onNewDocument={() => void newDocument()}
          onRename={(t) => docId && void rename(docId, t)}
        />
      )}
      <div className="min-h-0 flex-1">
        {docId ? (
          <HandwritingEditor
            key={docId}
            ref={editor}
            documentId={docId}
            storage={storage}
            onStatusChange={onStatus}
            onSave={onSave}
            onFocusModeChange={onFocus}
          />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Spinner /> Loading…
          </div>
        )}
      </div>
      <DocumentManager
        open={drawer}
        storage={storage}
        heading="Notebooks"
        currentId={docId ?? ''}
        refreshKey={refreshKey}
        onClose={() => setDrawer(false)}
        onOpenDocument={(id) => void openDocument(id)}
        onCreateDocument={() => void newDocument()}
        onRename={rename}
        onDeleted={(id, rem) => void onDeleted(id, rem)}
      />
    </div>
  );
}
