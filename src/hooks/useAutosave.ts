import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandwritingDocument } from '../types/document';
import type { StorageAdapter } from '../storage/StorageAdapter';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave. Also flushes when the page is hidden (iPad app switch,
 * tab close) so ink is not lost.
 */
export function useAutosave(
  doc: HandwritingDocument | null,
  dirtyVersion: number,
  storage: StorageAdapter,
  onSaved?: (doc: HandwritingDocument) => void,
  delayMs = 700,
) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<{ doc: HandwritingDocument | null; version: number }>({ doc, version: dirtyVersion });
  const savedVersion = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  latest.current = { doc, version: dirtyVersion };

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) await saving.current.catch(() => undefined);
    const { doc: d, version } = latest.current;
    if (!d || version === savedVersion.current) return;
    setStatus('saving');
    const p = storage
      .saveDocument(d)
      .then(() => {
        savedVersion.current = version;
        setLastSavedAt(Date.now());
        setError(null);
        setStatus(latest.current.version === version ? 'saved' : 'pending');
        onSavedRef.current?.(d);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      })
      .finally(() => {
        saving.current = null;
      });
    saving.current = p;
    await p;
    if (latest.current.version !== savedVersion.current && !timer.current) {
      timer.current = setTimeout(() => void flush(), delayMs);
    }
  }, [storage, delayMs]);

  // A new document was loaded: it is already persisted.
  useEffect(() => {
    savedVersion.current = 0;
    setStatus('idle');
  }, [doc?.id]);

  useEffect(() => {
    if (!doc || dirtyVersion === 0 || dirtyVersion === savedVersion.current) return;
    setStatus('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delayMs);
  }, [doc, dirtyVersion, delayMs, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      void flush();
    };
  }, [flush]);

  return { status, lastSavedAt, error, flush };
}
