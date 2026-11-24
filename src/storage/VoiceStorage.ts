import type { DocumentSummary } from '../types/document';
import type { VoiceDocument } from '../types/speech';
import { STORES, openDatabase, promisify, txDone } from './db';
import { transcriptText } from '../state/voiceText';

/** Persistence contract for voice documents (a host app can supply its own). */
export interface VoiceStorageAdapter {
  listDocuments(): Promise<DocumentSummary[]>;
  loadDocument(id: string): Promise<VoiceDocument | null>;
  saveDocument(doc: VoiceDocument): Promise<void>;
  /** Deletes the transcript and every audio recording that belongs to it. */
  deleteDocument(id: string): Promise<void>;
  saveAudio(recordingId: string, documentId: string, wav: Blob): Promise<void>;
  loadAudio(recordingId: string): Promise<Blob | null>;
  deleteAudio(recordingId: string): Promise<void>;
}

interface AudioRow {
  id: string;
  documentId: string;
  wav: Blob;
  createdAt: number;
}

export function summarizeVoice(doc: VoiceDocument): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pageCount: doc.recordings.length,
    preview: transcriptText(doc.segments).replace(/\s+/g, ' ').slice(0, 140),
  };
}

export class IndexedDBVoiceStorage implements VoiceStorageAdapter {
  async listDocuments(): Promise<DocumentSummary[]> {
    const db = await openDatabase();
    const tx = db.transaction(STORES.voiceSummaries, 'readonly');
    const rows = await promisify(tx.objectStore(STORES.voiceSummaries).getAll() as IDBRequest<DocumentSummary[]>);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadDocument(id: string): Promise<VoiceDocument | null> {
    const db = await openDatabase();
    const tx = db.transaction(STORES.voiceDocuments, 'readonly');
    return ((await promisify(tx.objectStore(STORES.voiceDocuments).get(id))) as VoiceDocument | undefined) ?? null;
  }

  async saveDocument(doc: VoiceDocument): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction([STORES.voiceDocuments, STORES.voiceSummaries], 'readwrite');
    tx.objectStore(STORES.voiceDocuments).put(doc);
    tx.objectStore(STORES.voiceSummaries).put(summarizeVoice(doc));
    await txDone(tx);
  }

  async deleteDocument(id: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction([STORES.voiceDocuments, STORES.voiceSummaries, STORES.voiceAudio], 'readwrite');
    tx.objectStore(STORES.voiceDocuments).delete(id);
    tx.objectStore(STORES.voiceSummaries).delete(id);
    const audio = tx.objectStore(STORES.voiceAudio);
    // Delete inside the request callback (not after an await) so the transaction
    // is guaranteed to still be active, including on older Safari.
    const keysReq = audio.index('documentId').getAllKeys(id);
    keysReq.onsuccess = () => keysReq.result.forEach((k) => audio.delete(k));
    await txDone(tx);
  }

  async saveAudio(recordingId: string, documentId: string, wav: Blob): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(STORES.voiceAudio, 'readwrite');
    const row: AudioRow = { id: recordingId, documentId, wav, createdAt: Date.now() };
    tx.objectStore(STORES.voiceAudio).put(row);
    await txDone(tx);
  }

  async loadAudio(recordingId: string): Promise<Blob | null> {
    const db = await openDatabase();
    const tx = db.transaction(STORES.voiceAudio, 'readonly');
    const row = (await promisify(tx.objectStore(STORES.voiceAudio).get(recordingId))) as AudioRow | undefined;
    return row?.wav ?? null;
  }

  async deleteAudio(recordingId: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(STORES.voiceAudio, 'readwrite');
    tx.objectStore(STORES.voiceAudio).delete(recordingId);
    await txDone(tx);
  }
}
