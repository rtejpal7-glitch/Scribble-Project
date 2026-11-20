import { useEffect, useReducer, useRef, useState } from 'react';
import type { StorageAdapter } from '../storage/StorageAdapter';
import { editorReducer, initialEditorState } from '../state/editorReducer';
import { createDocument, normalizeDocument } from '../state/documentModel';

export type LoadState = 'loading' | 'ready' | 'error';

/** Loads (or creates) a document and exposes the editor reducer. */
export function useHandwriting(documentId: string, storage: StorageAdapter, initialTitle?: string) {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setLoadError(null);
    storage
      .loadDocument(documentId)
      .then(async (stored) => {
        if (cancelled) return;
        const doc = stored ? normalizeDocument(stored) : createDocument(initialTitle, documentId);
        dispatch({ type: 'load', doc });
        setLoadState('ready');
        if (!stored) await storage.saveDocument(doc).catch(() => undefined);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
    // initialTitle is only used when creating; changing it must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, storage]);

  return { state, dispatch, stateRef, loadState, loadError };
}
