import type { VoiceDocument } from '../types/speech';
import { SPEECH_LANGUAGES } from '../types/speech';
import { transcriptText } from '../state/voiceText';
import { downloadBlob, safeFileName } from './exportUtils';

const FONT_STACK =
  '"Noto Sans Devanagari", "Kohinoor Devanagari", "Nirmala UI", Mangal, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function header(doc: VoiceDocument) {
  const lang = SPEECH_LANGUAGES.find((l) => l.id === doc.language)?.label ?? doc.language;
  return `${doc.title}\n${new Date(doc.updatedAt).toLocaleString()} · ${lang}`;
}

/** UTF-8 text (Hindi preserved). */
export function exportVoiceText(doc: VoiceDocument): void {
  const body = `${header(doc)}\n\n${transcriptText(doc.segments)}\n`;
  downloadBlob(new Blob([body], { type: 'text/plain;charset=utf-8' }), `${safeFileName(doc.title)}.txt`);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * PDF export that renders Hindi correctly. jsPDF's built-in fonts cannot draw
 * Devanagari and it does not shape conjuncts, so each page is typeset by the
 * browser (which uses the system's Devanagari font) and embedded as an image.
 * Trade-off: text in this PDF is not selectable.
 */
export async function exportVoicePdf(doc: VoiceDocument): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const W = 1240,
    H = 1754; // A4 at 150 dpi
  const margin = 110;
  const bodySize = 30,
    lineH = 46;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth(),
    ph = pdf.internal.pageSize.getHeight();

  ctx.font = `${bodySize}px ${FONT_STACK}`;
  const lines = wrap(ctx, transcriptText(doc.segments) || '(empty)', W - margin * 2);
  let page = 0;
  let i = 0;
  while (i < lines.length || page === 0) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    let y = margin;
    if (page === 0) {
      ctx.fillStyle = '#0f172a';
      ctx.font = `600 44px ${FONT_STACK}`;
      for (const l of wrap(ctx, doc.title, W - margin * 2)) {
        ctx.fillText(l, margin, y + 40);
        y += 58;
      }
      ctx.fillStyle = '#64748b';
      ctx.font = `24px ${FONT_STACK}`;
      ctx.fillText(header(doc).split('\n')[1], margin, y + 22);
      y += 70;
    }
    ctx.fillStyle = '#111827';
    ctx.font = `${bodySize}px ${FONT_STACK}`;
    while (i < lines.length && y + lineH <= H - margin) {
      ctx.fillText(lines[i], margin, y + bodySize);
      y += lines[i] ? lineH : lineH * 0.6;
      i++;
    }
    ctx.fillStyle = '#94a3b8';
    ctx.font = `20px ${FONT_STACK}`;
    ctx.fillText(`Page ${page + 1}`, W - margin - 80, H - 50);
    if (page > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, ph);
    page++;
    if (page > 200) break;
  }
  pdf.save(`${safeFileName(doc.title)}.pdf`);
}
