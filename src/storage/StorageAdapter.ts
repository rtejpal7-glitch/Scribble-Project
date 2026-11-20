import type { DocumentSummary, HandwritingDocument } from '../types/document';

/**
 * Persistence contract for the handwriting module. The standalone app uses
 * IndexedDB; a host such as ClinicFlow can supply its own adapter (for example
 * one that saves to its backend against a consultation record).
 */
export interface StorageAdapter {
  listDocuments(): Promise<DocumentSummary[]>;
  loadDocument(id: string): Promise<HandwritingDocument | null>;
  saveDocument(doc: HandwritingDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;
}

export class MemoryStorage implements StorageAdapter {
  private docs = new Map<string, HandwritingDocument>();
  async listDocuments() {
    return [...this.docs.values()].map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async loadDocument(id: string) {
    const d = this.docs.get(id);
    return d ? structuredClone(d) : null;
  }
  async saveDocument(doc: HandwritingDocument) {
    this.docs.set(doc.id, structuredClone(doc));
  }
  async deleteDocument(id: string) {
    this.docs.delete(id);
  }
}

export function summarize(doc: HandwritingDocument): DocumentSummary {
  const first = doc.pages
    .flatMap((p) => p.text.blocks.map((b) => b.correctedText ?? b.recognizedText))
    .join(' ')
    .slice(0, 140);
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pageCount: doc.pages.length,
    preview: first,
  };
}
