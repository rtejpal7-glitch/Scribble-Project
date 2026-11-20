import type { HandwritingDocument } from '../types/document';
import { LINE_SPACING, MARGIN_LEFT, PAGE_HEIGHT, PAGE_WIDTH, RULE_TOP } from '../types/handwriting';
import { documentToPlainText } from '../state/snapshot';
import { pageFinalText } from '../sync/textSync';
import { pointWidth } from '../handwriting/inkRenderer';

export function safeFileName(title: string): string {
  return (title || 'notes').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'notes';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function exportText(doc: HandwritingDocument): void {
  const blob = new Blob([documentToPlainText(doc)], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, `${safeFileName(doc.title)}.txt`);
}

/** jsPDF's built-in fonts are WinAnsi; replace characters they cannot draw. */
function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

/** Recognised (and corrected) text as a PDF, one section per handwritten page. */
export async function exportTextPdf(doc: HandwritingDocument): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const margin = 56;
  const lineH = 16;
  let y = margin;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text(pdfSafe(doc.title), margin, y);
  y += 30;

  doc.pages.forEach((page, i) => {
    if (y > H - margin - 40) {
      pdf.addPage();
      y = margin;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(110);
    pdf.text(`Page ${i + 1}`, margin, y);
    y += lineH + 4;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(20);
    const text = pageFinalText(page.text) || '(no text)';
    for (const para of text.split('\n')) {
      const wrapped: string[] = para ? pdf.splitTextToSize(pdfSafe(para), W - margin * 2) : [''];
      for (const line of wrapped) {
        if (y > H - margin) {
          pdf.addPage();
          y = margin;
        }
        pdf.text(line, margin, y);
        y += lineH;
      }
    }
    y += lineH;
  });
  pdf.save(`${safeFileName(doc.title)} - text.pdf`);
}

/** Original handwriting as vector PDF, one A4 page per notebook page. */
export async function exportInkPdf(doc: HandwritingDocument, options: { ruled?: boolean } = {}): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const k = W / PAGE_WIDTH; // page units → pt (0.75 at 96 DPI)
  pdf.setLineCap('round');
  pdf.setLineJoin('round');

  doc.pages.forEach((page, idx) => {
    if (idx > 0) pdf.addPage();
    if (options.ruled !== false) {
      pdf.setDrawColor('#dbe3ee');
      pdf.setLineWidth(0.5);
      for (let y = RULE_TOP; y < PAGE_HEIGHT - 20; y += LINE_SPACING) pdf.line(0, y * k, W, y * k);
      pdf.setDrawColor('#f3c4c4');
      pdf.line(MARGIN_LEFT * k, 0, MARGIN_LEFT * k, PAGE_HEIGHT * k);
    }
    for (const s of page.strokes) {
      pdf.setDrawColor(s.color);
      pdf.setFillColor(s.color);
      if (s.x.length === 1) {
        pdf.circle(s.x[0] * k, s.y[0] * k, (pointWidth(s, 0) / 2) * k, 'F');
        continue;
      }
      for (let i = 1; i < s.x.length; i++) {
        pdf.setLineWidth(pointWidth(s, i - 1) * k);
        pdf.line(s.x[i - 1] * k, s.y[i - 1] * k, s.x[i] * k, s.y[i] * k);
      }
    }
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text(`${pdfSafe(doc.title)} - page ${idx + 1} of ${doc.pages.length}`, 24, PAGE_HEIGHT * k - 16);
  });
  pdf.save(`${safeFileName(doc.title)} - handwriting.pdf`);
}
