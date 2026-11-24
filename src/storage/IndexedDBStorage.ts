import type { DocumentSummary, HandwritingDocument } from '../types/document';
import { summarize, type StorageAdapter } from './StorageAdapter';
import { STORES, openDatabase, promisify, txDone } from './db';

const DOCS = STORES.documents;
const SUMMARIES = STORES.summaries;

/**
 * IndexedDB persistence for handwriting notebooks. Full documents (ink + text)
 * live in `documents`, and light rows for the document list live in
 * `summaries`. Both are written in one transaction so they never disagree.
 */
export class IndexedDBStorage implements StorageAdapter {
  async listDocuments(): Promise<DocumentSummary[]> {
    const db = await openDatabase();
    const tx = db.transaction(SUMMARIES, 'readonly');
    const rows = await promisify(tx.objectStore(SUMMARIES).getAll() as IDBRequest<DocumentSummary[]>);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadDocument(id: string): Promise<HandwritingDocument | null> {
    const db = await openDatabase();
    const tx = db.transaction(DOCS, 'readonly');
    const doc = await promisify(tx.objectStore(DOCS).get(id) as IDBRequest<HandwritingDocument | undefined>);
    return doc ?? null;
  }

  async saveDocument(doc: HandwritingDocument): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction([DOCS, SUMMARIES], 'readwrite');
    tx.objectStore(DOCS).put(doc);
    tx.objectStore(SUMMARIES).put(summarize(doc));
    await txDone(tx);
  }

  async deleteDocument(id: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction([DOCS, SUMMARIES], 'readwrite');
    tx.objectStore(DOCS).delete(id);
    tx.objectStore(SUMMARIES).delete(id);
    await txDone(tx);
  }
}

/** Ask the browser not to evict our data (important on iPad Safari). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted?.()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}
