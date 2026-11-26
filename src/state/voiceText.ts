import type { TranscriptSegment, VoiceDocument, VoiceSnapshot } from '../types/speech';

/** Plain text of a transcript: segments joined by spaces, paragraphs by a blank line. */
export function transcriptText(segments: TranscriptSegment[], recognized = false): string {
  const paragraphs: string[][] = [];
  for (const s of segments) {
    const t = (recognized ? s.recognizedText : s.text).trim();
    if (!t || s.status === 'failed') continue;
    if (s.paragraphStart || paragraphs.length === 0) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(t);
  }
  return paragraphs.map((p) => p.join(' ')).join('\n\n');
}

export function buildVoiceSnapshot(doc: VoiceDocument): VoiceSnapshot {
  return {
    documentId: doc.id,
    title: doc.title,
    updatedAt: doc.updatedAt,
    language: doc.language,
    text: transcriptText(doc.segments),
    recognizedText: transcriptText(doc.segments.filter((s) => s.source === 'speech'), true),
    hasManualEdits: doc.segments.some((s) => s.edited || s.source === 'typed'),
    segments: doc.segments,
    recordings: doc.recordings,
    report: doc.report,
  };
}
