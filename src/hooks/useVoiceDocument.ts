import { useEffect, useReducer, useRef, useState } from 'react';
import type { VoiceStorageAdapter } from '../storage/VoiceStorage';
import { createVoiceDocument, initialVoiceState, normalizeVoiceDocument, voiceReducer } from '../state/voiceReducer';
import type { LoadState } from './useHandwriting';

/** Loads (or creates) a voice document and exposes its reducer. */
export function useVoiceDocument(documentId: string, storage: VoiceStorageAdapter, initialTitle?: string) {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    storage
      .loadDocument(documentId)
      .then(async (stored) => {
        if (cancelled) return;
        const doc = stored ? normalizeVoiceDocument(stored) : createVoiceDocument(initialTitle, documentId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, storage]);

  return { state, dispatch, stateRef, loadState, loadError };
}
