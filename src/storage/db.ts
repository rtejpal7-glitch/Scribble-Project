/**
 * Shared IndexedDB database. Each input type has its own object stores:
 *   documents / summaries             handwriting notebooks (v1)
 *   voiceDocuments / voiceSummaries   voice transcripts (v2)
 *   voiceAudio                        optional retained recordings (v2)
 * Upgrades only add stores, so existing notebooks are preserved.
 */

export const DB_NAME = 'inkflow';
export const DB_VERSION = 2;

export const STORES = {
  documents: 'documents',
  summaries: 'summaries',
  voiceDocuments: 'voiceDocuments',
  voiceSummaries: 'voiceSummaries',
  voiceAudio: 'voiceAudio',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of Object.values(STORES)) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            if (name === STORES.voiceAudio) store.createIndex('documentId', 'documentId', { unique: false });
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab. Close other InkFlow tabs and reload.'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}
