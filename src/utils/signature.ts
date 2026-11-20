/**
 * Order-independent signature of a set of stroke IDs. Two identical stroke sets
 * always produce the same signature, which is what lets recognition results and
 * manual corrections be re-attached after undo / redo.
 */
export function strokeSignature(ids: Iterable<string>): string {
  const sorted = Array.from(ids).sort();
  if (sorted.length === 0) return 'empty';
  // Two independent 32-bit FNV-1a hashes → 64 bits, plenty for per-page use.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ sorted.length;
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) {
      const c = id.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    }
    h1 = Math.imul(h1 ^ 0x2c, 0x01000193); // separator
    h2 = Math.imul(h2 ^ 0x2c, 0x5bd1e995);
  }
  return `${sorted.length}-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  let inter = 0;
  for (const id of b) if (setA.has(id)) inter++;
  const union = setA.size + b.length - inter;
  return union === 0 ? 0 : inter / union;
}
