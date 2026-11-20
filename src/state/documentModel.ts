import type { HandwritingDocument, PageData } from '../types/document';
import { createId } from '../utils/id';
import { emptyPageText } from '../sync/textSync';

export function createPage(): PageData {
  return { id: createId('p_'), createdAt: Date.now(), strokes: [], inkRevision: 0, text: emptyPageText() };
}

export function createDocument(title = 'Untitled notes', id: string = createId('d_')): HandwritingDocument {
  const now = Date.now();
  return { schemaVersion: 1, id, title, createdAt: now, updatedAt: now, pages: [createPage()] };
}

/** Defensive normalisation of data loaded from storage (older or partial records). */
export function normalizeDocument(raw: HandwritingDocument): HandwritingDocument {
  const pages = (raw.pages?.length ? raw.pages : [createPage()]).map((p) => {
    const text = { ...emptyPageText(), ...(p.text ?? {}) };
    // A request cannot still be in flight after a reload.
    if (text.status === 'recognizing' || text.status === 'scheduled') text.status = 'idle';
    return {
      id: p.id ?? createId('p_'),
      createdAt: p.createdAt ?? Date.now(),
      strokes: Array.isArray(p.strokes) ? p.strokes : [],
      inkRevision: p.inkRevision ?? 0,
      text,
    };
  });
  return {
    schemaVersion: 1,
    id: raw.id,
    title: raw.title || 'Untitled notes',
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    pages,
  };
}
