import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { HandwritingDocument, HandwritingSnapshot } from '../types/document';
import { ERASER_SIZES, PEN_WIDTHS, type Stroke, type ToolState } from '../types/handwriting';
import type { ProviderAvailability, RecognitionStatus } from '../types/recognition';
import type { HandwritingRecognitionProvider } from '../recognition/HandwritingRecognitionProvider';
import { createDefaultProvider, defaultDebounceMs } from '../recognition/providerFactory';
import type { StorageAdapter } from '../storage/StorageAdapter';
import { IndexedDBStorage } from '../storage/IndexedDBStorage';
import { useHandwriting } from '../hooks/useHandwriting';
import { useRecognition } from '../hooks/useRecognition';
import { useAutosave, type SaveStatus } from '../hooks/useAutosave';
import { useMediaQuery, useOnlineStatus } from '../hooks/useOnlineStatus';
import { buildSnapshot, documentToPlainText, overallStatus } from '../state/snapshot';
import { HandwritingCanvas, clampZoom } from '../components/handwriting/HandwritingCanvas';
import { HandwritingToolbar } from '../components/handwriting/HandwritingToolbar';
import { TextOutputPanel, type ExportKind } from '../components/editor/TextOutputPanel';
import { SplitView } from '../components/layout/SplitView';
import { ConfirmProvider, useConfirm } from '../components/common/ConfirmDialog';
import { Spinner } from '../components/editor/RecognitionStatus';
import { copyToClipboard, exportInkPdf, exportText, exportTextPdf } from '../utils/exportUtils';

export interface EditorStatus {
  save: SaveStatus;
  lastSavedAt: number | null;
  online: boolean;
  recognition: RecognitionStatus;
  availability: ProviderAvailability | null;
  title: string;
}

export interface HandwritingEditorHandle {
  getSnapshot(): HandwritingSnapshot | null;
  setTitle(title: string): void;
  retryRecognition(pageId?: string): void;
  /** Persist immediately (e.g. before a host navigates away). */
  flush(): Promise<void>;
  exportAs(kind: ExportKind): Promise<void>;
}

export interface HandwritingEditorProps {
  documentId: string;
  /** Persistence. Defaults to IndexedDB in this browser. */
  storage?: StorageAdapter;
  /** Recognition engine. Defaults to the one selected by VITE_RECOGNITION_PROVIDER. */
  recognitionProvider?: HandwritingRecognitionProvider;
  /** Writing pause before recognition runs (ms). Default 500. */
  debounceMs?: number;
  /** Title used when the document does not exist yet. */
  initialTitle?: string;
  /** Final/corrected text changed (debounced by nature of recognition). */
  onTextChange?(snapshot: HandwritingSnapshot): void;
  /** Ink strokes changed (add / erase / undo / clear / page change). */
  onInkChange?(snapshot: HandwritingSnapshot): void;
  /** Called after each successful save. */
  onSave?(snapshot: HandwritingSnapshot): void;
  onStatusChange?(status: EditorStatus): void;
  onFocusModeChange?(focus: boolean): void;
  className?: string;
  ref?: Ref<HandwritingEditorHandle>;
}

let sharedStorage: StorageAdapter | null = null;
function defaultStorage(): StorageAdapter {
  return (sharedStorage ??= new IndexedDBStorage());
}

const TOOL_KEY = 'inkflow:tool';
const DEFAULT_TOOL: ToolState = {
  tool: 'pen',
  color: 'black',
  width: PEN_WIDTHS[1],
  eraserMode: 'stroke',
  eraserSize: ERASER_SIZES[1],
  fingerDrawing: false,
};
function loadTool(): ToolState {
  try {
    const raw = localStorage.getItem(TOOL_KEY);
    if (raw) return { ...DEFAULT_TOOL, ...JSON.parse(raw), tool: 'pen' };
  } catch {
    /* ignore */
  }
  return DEFAULT_TOOL;
}

/**
 * Self-contained handwriting editor: ink canvas, toolbar, recognition, live text
 * panel, autosave and export. It knows nothing about the host application.
 *
 * ```tsx
 * <HandwritingEditor documentId={consultation.notesId}
 *   onTextChange={(s) => setDraft(s.text)} onSave={(s) => api.saveNotes(s)} />
 * ```
 */
export function HandwritingEditor(props: HandwritingEditorProps) {
  return (
    <ConfirmProvider>
      <EditorInner {...props} />
    </ConfirmProvider>
  );
}

function EditorInner(props: HandwritingEditorProps) {
  const storage = useMemo(() => props.storage ?? defaultStorage(), [props.storage]);
  const [fallbackProvider] = useState(() => createDefaultProvider());
  const provider = props.recognitionProvider ?? fallbackProvider;
  const debounceMs = props.debounceMs ?? defaultDebounceMs();
  const confirm = useConfirm();
  const online = useOnlineStatus();

  const { state, dispatch, stateRef, loadState, loadError } = useHandwriting(props.documentId, storage, props.initialTitle);
  const { availability, retry, manager } = useRecognition({ provider, debounceMs, online, state, stateRef, dispatch });

  const cbs = useRef(props);
  cbs.current = props;
  const onSaved = useCallback((doc: HandwritingDocument) => {
    cbs.current.onSave?.(buildSnapshot(doc));
  }, []);
  const save = useAutosave(state.doc, state.dirtyVersion, storage, onSaved);

  const [tool, setTool] = useState<ToolState>(loadTool);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [scrollRequest, setScrollRequest] = useState<{ index: number; nonce: number } | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [showText, setShowText] = useState(true);
  const [penSeen, setPenSeen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'write' | 'text'>('write');
  const rootRef = useRef<HTMLDivElement>(null);

  const wide = useMediaQuery('(min-width: 900px)');
  const phone = useMediaQuery('(max-width: 639px)');
  const orientation = wide ? 'horizontal' : 'vertical';

  const updateTool = useCallback((patch: Partial<ToolState>) => {
    setTool((t) => {
      const next = { ...t, ...patch };
      try {
        localStorage.setItem(TOOL_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const doc = state.doc;
  const pageCount = doc?.pages.length ?? 1;
  const safeCurrent = Math.min(currentPage, pageCount - 1);
  const currentPageId = doc?.pages[safeCurrent]?.id;

  /* ------------------------------ actions ------------------------------ */
  const onAddStroke = useCallback((pageId: string, stroke: Stroke) => dispatch({ type: 'addStroke', pageId, stroke }), [dispatch]);
  const onErase = useCallback(
    (pageId: string, removed: Stroke[], added: Stroke[]) => dispatch({ type: 'erase', pageId, removed, added }),
    [dispatch],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), [dispatch]);
  const redo = useCallback(() => dispatch({ type: 'redo' }), [dispatch]);
  const goToPage = useCallback((index: number) => {
    setCurrentPage(index);
    setScrollRequest({ index, nonce: Date.now() });
    setMobileTab('write');
  }, []);
  const addPage = useCallback(() => {
    const d = stateRef.current.doc;
    if (!d) return;
    const after = d.pages[Math.min(currentPage, d.pages.length - 1)]?.id;
    const index = d.pages.findIndex((p) => p.id === after) + 1;
    dispatch({ type: 'addPage', afterPageId: after });
    setTimeout(() => goToPage(index), 30);
  }, [dispatch, stateRef, currentPage, goToPage]);

  const clearPage = async () => {
    const page = doc?.pages[safeCurrent];
    if (!page || !page.strokes.length) return;
    const ok = await confirm({
      title: `Clear page ${safeCurrent + 1}?`,
      message: 'All handwriting on this page and its converted text will be removed. You can undo this.',
      confirmLabel: 'Clear page',
      destructive: true,
    });
    if (ok) dispatch({ type: 'clearPage', pageId: page.id });
  };
  const deletePage = async () => {
    const page = doc?.pages[safeCurrent];
    if (!page) return;
    const ok = await confirm({
      title: `Delete page ${safeCurrent + 1}?`,
      message: 'The page, its handwriting and its text will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Delete page',
      destructive: true,
    });
    if (ok) {
      dispatch({ type: 'deletePage', pageId: page.id });
      setCurrentPage((c) => Math.max(0, Math.min(c, pageCount - 2)));
    }
  };
  const clearText = async (pageId: string) => {
    const idx = doc?.pages.findIndex((p) => p.id === pageId) ?? 0;
    const ok = await confirm({
      title: `Clear text for page ${idx + 1}?`,
      message:
        'The converted text, your corrections and typed notes for this page will be removed. The handwriting stays on the page, and new writing will still be converted.',
      confirmLabel: 'Clear text',
      destructive: true,
    });
    if (ok) dispatch({ type: 'clearText', pageId });
  };

  const exportAs = useCallback(
    async (kind: ExportKind) => {
      const d = stateRef.current.doc;
      if (!d) return;
      try {
        if (kind === 'txt') exportText(d);
        else if (kind === 'text-pdf') await exportTextPdf(d);
        else await exportInkPdf(d);
      } catch (e) {
        alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [stateRef],
  );

  const toggleFocus = useCallback(async () => {
    const next = !focusMode;
    setFocusMode(next);
    cbs.current.onFocusModeChange?.(next);
    const el = rootRef.current as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
    const d = document as Document & { webkitExitFullscreen?: () => Promise<void>; webkitFullscreenElement?: Element };
    try {
      if (next && el && !document.fullscreenElement && !d.webkitFullscreenElement) {
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      } else if (!next && (document.fullscreenElement || d.webkitFullscreenElement)) {
        await (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      }
    } catch {
      /* Fullscreen API not available (e.g. iPhone): focus mode still hides the chrome. */
    }
  }, [focusMode]);

  // Leaving native fullscreen (Esc / system gesture) leaves focus mode too.
  useEffect(() => {
    const onChange = () => {
      const d = document as Document & { webkitFullscreenElement?: Element };
      if (!document.fullscreenElement && !d.webkitFullscreenElement && focusMode) {
        setFocusMode(false);
        cbs.current.onFocusModeChange?.(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [focusMode]);

  /* --------------------------- keyboard shortcuts --------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return; // native text undo inside text fields
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey) {
        if (k === 'p') updateTool({ tool: 'pen' });
        else if (k === 'e') updateTool({ tool: 'eraser' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, updateTool]);

  /* ------------------------------ host callbacks ------------------------------ */
  const prevInk = useRef('');
  const prevText = useRef('');
  useEffect(() => {
    if (!doc) return;
    const { onInkChange, onTextChange } = cbs.current;
    if (!onInkChange && !onTextChange) return;
    const inkKey = doc.pages.map((p) => `${p.id}:${p.inkRevision}`).join('|');
    const snapshot = buildSnapshot(doc);
    const textKey = `${snapshot.text}\u0000${snapshot.recognitionStatus}`;
    if (onInkChange && prevInk.current && inkKey !== prevInk.current) onInkChange(snapshot);
    if (onTextChange && prevText.current && textKey !== prevText.current) onTextChange(snapshot);
    prevInk.current = inkKey;
    prevText.current = textKey;
  }, [doc]);

  const recognition = overallStatus(doc?.pages.filter((p) => p.strokes.length).map((p) => p.text.status) ?? []);
  useEffect(() => {
    cbs.current.onStatusChange?.({
      save: save.status,
      lastSavedAt: save.lastSavedAt,
      online,
      recognition,
      availability,
      title: doc?.title ?? '',
    });
  }, [save.status, save.lastSavedAt, online, recognition, availability, doc?.title]);

  useImperativeHandle(
    props.ref,
    () => ({
      getSnapshot: () => (stateRef.current.doc ? buildSnapshot(stateRef.current.doc) : null),
      setTitle: (title) => dispatch({ type: 'setTitle', title }),
      retryRecognition: (pageId) => retry(pageId),
      flush: () => save.flush(),
      exportAs,
    }),
    [dispatch, retry, save, exportAs, stateRef],
  );

  /* --------------------------------- render --------------------------------- */
  if (loadState === 'loading' || !doc) {
    if (loadState === 'error') {
      return (
        <div className="flex h-full items-center justify-center p-6 text-sm text-red-700">
          Could not open this document: {loadError}
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        <Spinner /> Opening notebook…
      </div>
    );
  }

  const canvasPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <HandwritingToolbar
        tool={tool}
        onToolChange={updateTool}
        canUndo={state.history.undo.length > 0}
        canRedo={state.history.redo.length > 0}
        onUndo={undo}
        onRedo={redo}
        onClearPage={clearPage}
        onAddPage={addPage}
        zoom={zoom}
        onZoomIn={() => setZoom((z) => clampZoom(z * 1.2))}
        onZoomOut={() => setZoom((z) => clampZoom(z / 1.2))}
        onFitWidth={() => setFitNonce((n) => n + 1)}
        focusMode={focusMode}
        onToggleFocus={toggleFocus}
        textPanelVisible={showText}
        onToggleTextPanel={phone ? undefined : () => setShowText((s) => !s)}
        currentPage={safeCurrent}
        pageCount={pageCount}
        onGoToPage={goToPage}
        onDeletePage={deletePage}
      />
      <div className="relative min-h-0 flex-1">
        <HandwritingCanvas
          pages={doc.pages}
          zoom={zoom}
          tool={tool}
          onZoomChange={(z) => setZoom(z)}
          onAddStroke={onAddStroke}
          onErase={onErase}
          onAddPage={addPage}
          onCurrentPageChange={setCurrentPage}
          onPenDetected={() => setPenSeen(true)}
          onInkStart={() => manager.current?.warmUp()}
          scrollRequest={scrollRequest}
          fitWidthNonce={fitNonce}
        />
      </div>
      <StatusBar
        save={save.status}
        saveError={save.error}
        online={online}
        availability={availability}
        providerName={provider.displayName}
        penSeen={penSeen}
      />
    </div>
  );

  const textPanel = (
    <TextOutputPanel
      doc={doc}
      currentPage={safeCurrent}
      availability={availability}
      online={online}
      onEditBlock={(pageId, blockId, value) => dispatch({ type: 'editBlock', pageId, blockId, value })}
      onRevertBlock={(pageId, blockId) => dispatch({ type: 'revertBlock', pageId, blockId })}
      onResolveConflict={(pageId, blockId, choice) => dispatch({ type: 'resolveConflict', pageId, blockId, choice })}
      onTypedText={(pageId, value) => dispatch({ type: 'setTypedText', pageId, value })}
      onRetry={retry}
      onClearText={clearText}
      onRestoreHidden={(pageId) => dispatch({ type: 'restoreHidden', pageId })}
      onCopyAll={() => copyToClipboard(documentToPlainText(doc, doc.pages.length > 1).trim())}
      onExport={exportAs}
      onGoToPage={goToPage}
    />
  );

  return (
    <div ref={rootRef} className={`hw-editor flex h-full min-h-0 w-full flex-col bg-white ${props.className ?? ''}`} data-current-page={currentPageId}>
      {phone && !focusMode ? (
        <>
          <div className="flex h-10 shrink-0 border-b border-slate-200 bg-white text-[13px] font-medium" role="tablist">
            {(['write', 'text'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={mobileTab === tab}
                onClick={() => setMobileTab(tab)}
                className={`flex-1 border-b-2 ${mobileTab === tab ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}
              >
                {tab === 'write' ? 'Handwriting' : 'Text'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <div className={mobileTab === 'write' ? 'h-full' : 'hidden'}>{canvasPanel}</div>
            <div className={mobileTab === 'text' ? 'h-full' : 'hidden'}>{textPanel}</div>
          </div>
        </>
      ) : (
        <SplitView
          orientation={orientation}
          showSecond={showText && !focusMode}
          storageKey="inkflow:split"
          defaultRatio={orientation === 'horizontal' ? 0.6 : 0.64}
          first={canvasPanel}
          second={textPanel}
        />
      )}
    </div>
  );
}

function StatusBar(p: {
  save: SaveStatus;
  saveError: string | null;
  online: boolean;
  availability: ProviderAvailability | null;
  providerName: string;
  penSeen: boolean;
}) {
  const saveLabel =
    p.save === 'saving' || p.save === 'pending'
      ? 'Saving…'
      : p.save === 'error'
        ? `Save failed${p.saveError ? `: ${p.saveError}` : ''}`
        : 'All changes saved on this device';
  const recLabel = !p.availability
    ? `${p.providerName}: checking…`
    : p.availability.available
      ? `${p.providerName}: connected`
      : `${p.providerName}: not available`;
  return (
    <div className="flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t border-slate-200 bg-white px-3 text-[11.5px] whitespace-nowrap text-slate-500">
      <span className="inline-flex items-center gap-1.5" role="status" aria-label="Autosave status">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            p.save === 'error' ? 'bg-red-500' : p.save === 'saving' || p.save === 'pending' ? 'bg-amber-400' : 'bg-emerald-500'
          }`}
        />
        {saveLabel}
      </span>
      <span className="inline-flex items-center gap-1.5" aria-label="Connection status">
        <span className={`h-1.5 w-1.5 rounded-full ${p.online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
        {p.online ? 'Online' : 'Offline'}
      </span>
      <span className="hidden truncate sm:inline" title={p.availability?.reason}>
        {recLabel}
      </span>
      {p.penSeen && <span className="ml-auto hidden md:inline">Stylus detected · fingers scroll</span>}
    </div>
  );
}
