import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import type { HandwritingRecognitionProvider } from '../recognition/HandwritingRecognitionProvider';
import { RecognitionManager } from '../recognition/RecognitionManager';
import type { EditorAction, EditorState } from '../state/editorReducer';
import type { ProviderAvailability } from '../types/recognition';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../types/handwriting';
import { strokeSignature } from '../utils/signature';

interface Options {
  provider: HandwritingRecognitionProvider;
  debounceMs: number;
  online: boolean;
  state: EditorState;
  stateRef: MutableRefObject<EditorState>;
  dispatch: Dispatch<EditorAction>;
}

/**
 * Connects the editor state to a RecognitionManager: every ink revision change
 * schedules recognition for that page; results come back as reducer actions
 * (which apply the revision guard).
 */
export function useRecognition({ provider, debounceMs, online, state, stateRef, dispatch }: Options) {
  const managerRef = useRef<RecognitionManager | null>(null);
  const seen = useRef(new Map<string, number>());
  const [availability, setAvailability] = useState<ProviderAvailability | null>(null);
  const docId = state.doc?.id ?? null;

  useEffect(() => {
    if (!docId) return;
    seen.current = new Map();
    const manager = new RecognitionManager({
      provider,
      debounceMs,
      initiallyOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
      getPage: (pageId) => {
        const p = stateRef.current.doc?.pages.find((pg) => pg.id === pageId);
        return p ? { pageId: p.id, revision: p.inkRevision, strokes: p.strokes, width: PAGE_WIDTH, height: PAGE_HEIGHT } : null;
      },
      onUpdate: (u) => dispatch({ type: 'recognition', ...u }),
      onAvailabilityChange: setAvailability,
    });
    managerRef.current = manager;
    return () => {
      manager.dispose();
      if (managerRef.current === manager) managerRef.current = null;
    };
    // debounceMs is applied live below; stateRef/dispatch are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, docId]);

  useEffect(() => {
    managerRef.current?.setDebounce(debounceMs);
  }, [debounceMs]);

  useEffect(() => {
    managerRef.current?.setOnline(online);
  }, [online]);

  // Watch ink revisions.
  useEffect(() => {
    const doc = state.doc;
    const m = managerRef.current;
    if (!doc || !m) return;
    const present = new Set<string>();
    for (const p of doc.pages) {
      present.add(p.id);
      const prev = seen.current.get(p.id);
      if (prev === undefined) {
        seen.current.set(p.id, p.inkRevision);
        if (p.strokes.length > 0) {
          const sig = strokeSignature(p.strokes.map((s) => s.id));
          const stale = p.text.recognizedSignature !== sig || p.text.status !== 'recognized';
          if (stale) m.schedule(p.id, { immediate: true });
        }
      } else if (prev !== p.inkRevision) {
        seen.current.set(p.id, p.inkRevision);
        m.schedule(p.id);
      }
    }
    for (const id of [...seen.current.keys()]) {
      if (!present.has(id)) {
        m.cancel(id);
        seen.current.delete(id);
      }
    }
  }, [state.doc]);

  const retry = useCallback((pageId?: string) => {
    const m = managerRef.current;
    const doc = stateRef.current.doc;
    if (!m || !doc) return;
    const ids = pageId ? [pageId] : doc.pages.filter((p) => p.strokes.length > 0).map((p) => p.id);
    ids.forEach((id) => m.retry(id));
  }, [stateRef]);

  return { availability, retry, manager: managerRef };
}
