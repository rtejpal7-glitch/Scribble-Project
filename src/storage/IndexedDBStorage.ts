import type { DocumentSummary, HandwritingDocument } from '../types/document';
import { summarize, type StorageAdapter } from './StorageAdapter';

const DB_NAME = 'inkflow';
const DB_VERSION = 1;
const DOCS = 'documents';
const SUMMARIES = 'summaries';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/**
 * IndexedDB persistence. Full documents (ink + text) live in `documents`, and
 * light rows for the document list live in `summaries`; both are written in one
 * transaction so they never disagree.
 */
export class IndexedDBStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('IndexedDB is not available in this browser.'));
          return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          // Another tab upgraded the schema: close so it can proceed.
          db.onversionchange = () => db.close();
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab.'));
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  async listDocuments(): Promise<DocumentSummary[]> {
    const db = await this.db();
    const tx = db.transaction(SUMMARIES, 'readonly');
    const rows = await promisify(tx.objectStore(SUMMARIES).getAll() as IDBRequest<DocumentSummary[]>);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadDocument(id: string): Promise<HandwritingDocument | null> {
    const db = await this.db();
    const tx = db.transaction(DOCS, 'readonly');
    const doc = await promisify(tx.objectStore(DOCS).get(id) as IDBRequest<HandwritingDocument | undefined>);
    return doc ?? null;
  }

  async saveDocument(doc: HandwritingDocument): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([DOCS, SUMMARIES], 'readwrite');
    tx.objectStore(DOCS).put(doc);
    tx.objectStore(SUMMARIES).put(summarize(doc));
    await txDone(tx);
  }

  async deleteDocument(id: string): Promise<void> {
    const db = await this.db();
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
