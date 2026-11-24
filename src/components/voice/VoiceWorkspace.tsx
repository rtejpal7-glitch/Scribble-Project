import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VoiceToTextEditor, type VoiceEditorStatus, type VoiceToTextEditorHandle } from '../../voice-module';
import { IndexedDBVoiceStorage } from '../../storage/VoiceStorage';
import { createVoiceDocument } from '../../state/voiceReducer';
import { WorkspaceHeader } from '../layout/WorkspaceHeader';
import { DocumentManager } from '../documents/DocumentManager';
import { Spinner } from '../editor/RecognitionStatus';
import type { DocumentSummary } from '../../types/document';

const LAST_DOC_KEY = 'inkflow:lastVoiceDocument';

interface Props {
  active: boolean;
  onRecordingChange?(recording: boolean): void;
}

/** Standalone-app wrapper around VoiceToTextEditor: document selection and list. */
export function VoiceWorkspace({ active, onRecordingChange }: Props) {
  const storage = useMemo(() => new IndexedDBVoiceStorage(), []);
  const [docId, setDocId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [status, setStatus] = useState<VoiceEditorStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const editor = useRef<VoiceToTextEditorHandle>(null);

  useEffect(() => {
    (async () => {
      const docs = await storage.listDocuments();
      const last = localStorage.getItem(LAST_DOC_KEY);
      if (last && docs.some((d) => d.id === last)) return setDocId(last);
      if (docs[0]) return setDocId(docs[0].id);
      const doc = createVoiceDocument();
      await storage.saveDocument(doc);
      setDocId(doc.id);
    })().catch((e: unknown) => setBootError(e instanceof Error ? e.message : String(e)));
  }, [storage]);

  useEffect(() => {
    if (docId) localStorage.setItem(LAST_DOC_KEY, docId);
  }, [docId]);

  useEffect(() => onRecordingChange?.(!!status?.recording), [status?.recording, onRecordingChange]);

  // Switching documents ends the current recording first (nothing recorded in the background).
  const leaveCurrent = useCallback(async () => {
    await editor.current?.stopAndSave();
  }, []);

  const openDocument = useCallback(
    async (id: string) => {
      await leaveCurrent();
      setDocId(id);
      setDrawer(false);
    },
    [leaveCurrent],
  );

  const newDocument = useCallback(async () => {
    await leaveCurrent();
    const current = editor.current?.getSnapshot();
    const doc = createVoiceDocument(undefined, undefined, current?.language);
    await storage.saveDocument(doc);
    setDocId(doc.id);
    setDrawer(false);
    setRefreshKey((k) => k + 1);
  }, [leaveCurrent, storage]);

  const rename = useCallback(
    async (id: string, title: string) => {
      if (id === docId) {
        editor.current?.setTitle(title);
        await new Promise((r) => setTimeout(r, 0));
        await editor.current?.flush();
      } else {
        const doc = await storage.loadDocument(id);
        if (doc) await storage.saveDocument({ ...doc, title, updatedAt: Date.now() });
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
        const doc = createVoiceDocument();
        await storage.saveDocument(doc);
        setDocId(doc.id);
        setRefreshKey((k) => k + 1);
      }
    },
    [docId, storage],
  );

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-red-700">
        Local storage is unavailable: {bootError}.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        title={status?.title ?? ''}
        documentsLabel="Dictations"
        onOpenDocuments={() => setDrawer(true)}
        onNewDocument={() => void newDocument()}
        onRename={(t) => docId && void rename(docId, t)}
        right={
          status?.recording ? (
            <span className="mr-1 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[12px] font-medium text-red-700 ring-1 ring-red-200 ring-inset">
              <span className={`h-2 w-2 rounded-full bg-red-500 ${status.phase === 'recording' ? 'animate-pulse' : ''}`} />
              {status.phase === 'paused' ? 'Paused' : status.phase === 'finishing' ? 'Finishing' : 'Recording'}
            </span>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        {docId ? (
          <VoiceToTextEditor
            key={docId}
            ref={editor}
            documentId={docId}
            storage={storage}
            active={active}
            onStatusChange={setStatus}
            onSave={() => setRefreshKey((k) => k + 1)}
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
        heading="Dictations"
        countLabel={(n) => `${n} recording${n === 1 ? '' : 's'}`}
        footer="Transcripts (and audio, if you chose to keep it) are stored only on this device. Deleting a dictation also deletes its recordings."
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
