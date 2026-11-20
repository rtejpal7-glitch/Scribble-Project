import type { HandwritingDocument, HandwritingSnapshot, PageSnapshot } from '../types/document';
import type { RecognitionStatus } from '../types/recognition';
import { pageFinalText, pageHasManualEdits, pageRecognizedText } from '../sync/textSync';

const STATUS_RANK: RecognitionStatus[] = [
  'error',
  'unavailable',
  'pending-offline',
  'recognizing',
  'scheduled',
  'recognized',
  'idle',
];

export function overallStatus(statuses: RecognitionStatus[]): RecognitionStatus {
  let best: RecognitionStatus = 'idle';
  for (const s of statuses) if (STATUS_RANK.indexOf(s) < STATUS_RANK.indexOf(best)) best = s;
  return best;
}

export function buildSnapshot(doc: HandwritingDocument): HandwritingSnapshot {
  const pages: PageSnapshot[] = doc.pages.map((p, i) => ({
    pageId: p.id,
    pageNumber: i + 1,
    strokes: p.strokes,
    recognizedText: pageRecognizedText(p.text),
    text: pageFinalText(p.text),
    hasManualEdits: pageHasManualEdits(p.text),
    typedText: p.text.typedText,
    recognitionStatus: p.text.status,
    lastRecognizedAt: p.text.lastRecognizedAt,
  }));
  return {
    documentId: doc.id,
    title: doc.title,
    updatedAt: doc.updatedAt,
    pages,
    text: pages
      .map((p) => p.text)
      .filter(Boolean)
      .join('\n\n'),
    recognizedText: pages
      .map((p) => p.recognizedText)
      .filter(Boolean)
      .join('\n\n'),
    recognitionStatus: overallStatus(doc.pages.map((p) => p.text.status)),
  };
}

/** Plain-text rendering with page headers, used for copy and TXT export. */
export function documentToPlainText(doc: HandwritingDocument, withHeaders = true): string {
  const parts = doc.pages.map((p, i) => {
    const t = pageFinalText(p.text);
    return withHeaders ? `--- Page ${i + 1} ---\n${t}` : t;
  });
  return (withHeaders ? parts : parts.filter(Boolean)).join('\n\n').trim() + '\n';
}
