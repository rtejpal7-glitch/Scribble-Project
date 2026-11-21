import type { BlockWord, CorrectionMemoryEntry, PageText, TextBlock } from '../types/document';
import type { RecognitionStatus, RecognizedLine } from '../types/recognition';
import { createId } from '../utils/id';
import { jaccard, strokeSignature } from '../utils/signature';
import { LINE_SPACING } from '../types/handwriting';

/**
 * Ink ↔ text synchronisation.
 *
 * The text for a page is *derived* from (a) the latest recognition lines,
 * (b) the correction memory and (c) the hidden-stroke set. Nothing is appended:
 * when strokes are erased, the next recognition no longer contains them, so the
 * words or lines they formed disappear from the text.
 *
 * Manual corrections are keyed by the stroke signature of the line they belong
 * to. That gives these rules:
 *  - Unrelated handwriting changes never touch a corrected line, because its
 *    strokes, and therefore its signature, are unchanged.
 *  - Undo / redo restores the old stroke set, so the old signature (and the
 *    correction stored for it) comes back.
 *  - If the strokes of a corrected line change (a word erased or added), the
 *    line shows the new recognition and is flagged as a *conflict*, and the user
 *    can restore their edit with one tap.
 *  - If all strokes of a line are erased, the line, and its correction, is gone
 *    from the text. The correction stays in memory in case of undo.
 */

export const MAX_CORRECTION_MEMORY = 500;

export function emptyPageText(): PageText {
  return {
    status: 'idle',
    error: null,
    lines: [],
    blocks: [],
    typedText: '',
    corrections: {},
    hiddenStrokeIds: [],
    lastRecognizedAt: null,
    recognizedSignature: null,
    provider: null,
  };
}

const MAX_ALTERNATIVES = 4;

function blockWords(line: RecognizedLine): BlockWord[] {
  return line.words.map((w) => {
    const seen = new Set([w.text]);
    const alternatives: string[] = [];
    for (const c of w.candidates ?? []) {
      const t = c.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      alternatives.push(t);
      if (alternatives.length >= MAX_ALTERNATIVES) break;
    }
    return { text: w.text, alternatives };
  });
}

/** Line text with word `index` replaced by `replacement`. */
export function replaceWord(words: BlockWord[], index: number, replacement: string): string {
  return words.map((w, i) => (i === index ? replacement : w.text)).join(' ');
}

function lineSignature(line: RecognizedLine, index: number): string {
  return line.strokeIds.length ? strokeSignature(line.strokeIds) : `nolink:${index}:${line.text}`;
}

/**
 * A new paragraph starts when the writer leaves a visible gap: the line centre
 * moved down by more than ~1.6 ruled lines (a skipped line), or the empty space
 * between the lines is clearly larger than a typical line's height.
 */
function markParagraphs(lines: RecognizedLine[]): boolean[] {
  const heights = lines
    .map((l) => (l.bbox ? l.bbox.maxY - l.bbox.minY : null))
    .filter((h): h is number => h !== null && h > 0)
    .sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  return lines.map((line, i) => {
    if (i === 0) return true;
    const prev = lines[i - 1];
    if (!line.bbox || !prev.bbox) return false;
    const pitch = (line.bbox.minY + line.bbox.maxY) / 2 - (prev.bbox.minY + prev.bbox.maxY) / 2;
    const gap = line.bbox.minY - prev.bbox.maxY;
    return pitch > LINE_SPACING * 1.6 || (median > 0 && gap > median * 1.5);
  });
}

/** Rebuilds blocks from recognition lines while preserving corrections and block identity. */
export function buildBlocks(
  lines: RecognizedLine[],
  previous: TextBlock[],
  corrections: Record<string, CorrectionMemoryEntry>,
  hiddenStrokeIds: readonly string[],
): TextBlock[] {
  const hidden = new Set(hiddenStrokeIds);
  const visible = lines.filter((l) => !(l.strokeIds.length > 0 && l.strokeIds.every((id) => hidden.has(id))));
  const paragraphs = markParagraphs(visible);
  const used = new Set<string>();
  const bySignature = new Map(previous.map((b) => [b.signature, b]));

  return visible.map((line, i) => {
    const signature = lineSignature(line, i);
    const base = {
      strokeIds: line.strokeIds,
      signature,
      recognizedText: line.text,
      paragraphStart: paragraphs[i],
      bbox: line.bbox,
      words: blockWords(line),
    };

    // 1. Identical stroke set → same line, keep its state (correction / conflict).
    const same = bySignature.get(signature);
    if (same && !used.has(same.id)) {
      used.add(same.id);
      const memory = corrections[signature];
      const correctedText = same.correctedText ?? memory?.correctedText ?? null;
      return {
        ...same,
        ...base,
        correctedText: correctedText === line.text ? null : correctedText,
      };
    }

    // 2. Stroke set seen before (undo / redo) → restore the remembered correction.
    const memory = corrections[signature];
    if (memory && memory.correctedText !== line.text) {
      const reuse = bestOverlap(previous, line.strokeIds, used, 0.3);
      if (reuse) used.add(reuse.id);
      return { id: reuse?.id ?? createId('b_'), ...base, correctedText: memory.correctedText, conflict: null };
    }

    // 3. Changed line. If it overlaps a line the user had corrected, flag a conflict.
    const overlap = bestOverlap(previous, line.strokeIds, used, 0.25);
    if (overlap) used.add(overlap.id);
    const priorCorrection = overlap?.correctedText ?? overlap?.conflict?.previousCorrection ?? null;
    return {
      id: overlap?.id ?? createId('b_'),
      ...base,
      correctedText: null,
      conflict:
        priorCorrection !== null && priorCorrection !== line.text
          ? {
              previousCorrection: priorCorrection,
              previousRecognized: overlap?.recognizedText ?? '',
            }
          : null,
    };
  });
}

function bestOverlap(blocks: TextBlock[], strokeIds: string[], used: Set<string>, min: number): TextBlock | null {
  let best: TextBlock | null = null;
  let score = min;
  for (const b of blocks) {
    if (used.has(b.id) || b.strokeIds.length === 0) continue;
    const j = jaccard(b.strokeIds, strokeIds);
    if (j >= score) {
      score = j;
      best = b;
    }
  }
  return best;
}

/* ------------------------------ page-level reducers ------------------------------ */

export function applyRecognitionResult(
  text: PageText,
  lines: RecognizedLine[],
  signature: string,
  provider: string,
  recognizedAt: number,
): PageText {
  return {
    ...text,
    status: 'recognized',
    error: null,
    lines,
    blocks: buildBlocks(lines, text.blocks, text.corrections, text.hiddenStrokeIds),
    recognizedSignature: signature,
    provider,
    lastRecognizedAt: recognizedAt,
  };
}

export function setPageStatus(text: PageText, status: RecognitionStatus, error: string | null = null): PageText {
  if (text.status === status && text.error === error) return text;
  return { ...text, status, error };
}

function rememberCorrection(
  corrections: Record<string, CorrectionMemoryEntry>,
  block: TextBlock,
  corrected: string | null,
): Record<string, CorrectionMemoryEntry> {
  const next = { ...corrections };
  if (corrected === null) {
    delete next[block.signature];
    return next;
  }
  next[block.signature] = {
    signature: block.signature,
    recognizedText: block.recognizedText,
    correctedText: corrected,
    updatedAt: Date.now(),
  };
  const keys = Object.keys(next);
  if (keys.length > MAX_CORRECTION_MEMORY) {
    keys
      .sort((a, b) => next[a].updatedAt - next[b].updatedAt)
      .slice(0, keys.length - MAX_CORRECTION_MEMORY)
      .forEach((k) => delete next[k]);
  }
  return next;
}

export function editBlock(text: PageText, blockId: string, value: string): PageText {
  const block = text.blocks.find((b) => b.id === blockId);
  if (!block) return text;
  const corrected = value === block.recognizedText ? null : value;
  return {
    ...text,
    blocks: text.blocks.map((b) => (b.id === blockId ? { ...b, correctedText: corrected, conflict: null } : b)),
    corrections: rememberCorrection(text.corrections, block, corrected),
  };
}

export function resolveConflict(text: PageText, blockId: string, choice: 'keep-mine' | 'use-new'): PageText {
  const block = text.blocks.find((b) => b.id === blockId);
  if (!block?.conflict) return text;
  if (choice === 'use-new') {
    return { ...text, blocks: text.blocks.map((b) => (b.id === blockId ? { ...b, conflict: null } : b)) };
  }
  return editBlock(text, blockId, block.conflict.previousCorrection);
}

export function revertBlock(text: PageText, blockId: string): PageText {
  const block = text.blocks.find((b) => b.id === blockId);
  if (!block) return text;
  return {
    ...text,
    blocks: text.blocks.map((b) => (b.id === blockId ? { ...b, correctedText: null, conflict: null } : b)),
    corrections: rememberCorrection(text.corrections, block, null),
  };
}

/** "Clear text": removes typed notes and corrections, and stops converting the current ink. */
export function clearPageText(text: PageText, currentStrokeIds: string[]): PageText {
  const hidden = Array.from(new Set([...text.hiddenStrokeIds, ...currentStrokeIds]));
  return {
    ...text,
    typedText: '',
    corrections: {},
    hiddenStrokeIds: hidden,
    blocks: buildBlocks(text.lines, [], {}, hidden),
  };
}

export function restoreHiddenText(text: PageText): PageText {
  return { ...text, hiddenStrokeIds: [], blocks: buildBlocks(text.lines, text.blocks, text.corrections, []) };
}

/** Drops hidden IDs for strokes that no longer exist (keeps documents small). */
export function pruneHidden(text: PageText, existing: Set<string>): PageText {
  if (!text.hiddenStrokeIds.length) return text;
  const kept = text.hiddenStrokeIds.filter((id) => existing.has(id));
  return kept.length === text.hiddenStrokeIds.length ? text : { ...text, hiddenStrokeIds: kept };
}

/* --------------------------------- text output --------------------------------- */

export function blockText(b: TextBlock): string {
  return b.correctedText ?? b.recognizedText;
}

/** Paragraphs separated by a blank line, lines within a paragraph by "\n". */
export function blocksToText(blocks: TextBlock[], useCorrections = true): string {
  let out = '';
  blocks.forEach((b, i) => {
    if (i > 0) out += b.paragraphStart ? '\n\n' : '\n';
    out += useCorrections ? blockText(b) : b.recognizedText;
  });
  return out;
}

export function pageFinalText(text: PageText): string {
  const ink = blocksToText(text.blocks);
  const typed = text.typedText.trim();
  if (ink && typed) return `${ink}\n\n${typed}`;
  return ink || typed;
}

export function pageRecognizedText(text: PageText): string {
  return blocksToText(text.blocks, false);
}

export function pageHasManualEdits(text: PageText): boolean {
  return text.blocks.some((b) => b.correctedText !== null) || text.typedText.trim().length > 0;
}
