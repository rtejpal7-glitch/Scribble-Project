/**
 * Light, language-aware clean-up of recognised utterances. It never translates
 * or transliterates: Hinglish stays Hinglish, Devanagari stays Devanagari.
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const TERMINAL = /[.!?।॥…]["')\]]*$/;

export function isDevanagari(ch: string): boolean {
  return DEVANAGARI.test(ch);
}

export function cleanText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.…]+/, '')
    .trim();
}

/** Capitalises the first Latin letter and adds a full stop (। after Devanagari) if missing. */
export function punctuate(text: string): string {
  let t = cleanText(text);
  if (!t) return t;
  t = t.replace(/^([a-z])/, (c) => c.toUpperCase());
  if (!TERMINAL.test(t)) {
    const last = t.replace(/["')\]]+$/, '').slice(-1);
    t += isDevanagari(last) ? '।' : '.';
  }
  return t;
}

function comparable(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Guards against engines that repeat or accumulate results (seen with
 * continuous browser recognition): drops exact repeats of the previous final
 * and strips a repeated prefix when a result contains the previous one.
 * Returns null when nothing new remains.
 */
export function dedupeFinal(previous: string | null, next: string): string | null {
  const n = cleanText(next);
  if (!n) return null;
  if (!previous) return n;
  const p = comparable(previous);
  const c = comparable(n);
  if (!c || c === p) return null;
  if (p && c.startsWith(p + ' ')) {
    // Remove the same number of words from the original string.
    const words = n.split(' ');
    const drop = p.split(' ').length;
    const rest = words.slice(drop).join(' ').trim();
    return rest || null;
  }
  return n;
}
