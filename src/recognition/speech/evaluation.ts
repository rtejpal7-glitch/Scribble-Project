/**
 * Word / character error rate for testing recognition on real samples.
 * Must stay consistent with speech-server/wer.py.
 */

const PUNCT = /[।॥.,!?;:"'“”‘’()[\]{}<>/\\|@#$%^&*_+=~`-]+/g;

export function normalizeForScoring(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
}

export type AlignOp = { op: 'ok' | 'sub' | 'del' | 'ins'; ref?: string; hyp?: string };

/** Levenshtein alignment with back-trace (for highlighting differences). */
export function align(ref: string[], hyp: string[]): { distance: number; ops: AlignOp[] } {
  const R = ref.length,
    H = hyp.length;
  const d: Uint32Array[] = Array.from({ length: R + 1 }, () => new Uint32Array(H + 1));
  for (let i = 0; i <= R; i++) d[i][0] = i;
  for (let j = 0; j <= H; j++) d[0][j] = j;
  for (let i = 1; i <= R; i++)
    for (let j = 1; j <= H; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const ops: AlignOp[] = [];
  let i = R,
    j = H;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push({ op: ref[i - 1] === hyp[j - 1] ? 'ok' : 'sub', ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'del', ref: ref[i - 1] });
      i--;
    } else {
      ops.push({ op: 'ins', hyp: hyp[j - 1] });
      j--;
    }
  }
  ops.reverse();
  return { distance: d[R][H], ops };
}

export interface Score {
  wer: number;
  cer: number;
  referenceWords: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  ops: AlignOp[];
}

export function score(reference: string, hypothesis: string): Score {
  const ref = normalizeForScoring(reference).split(' ').filter(Boolean);
  const hyp = normalizeForScoring(hypothesis).split(' ').filter(Boolean);
  const words = align(ref, hyp);
  const chars = align(
    Array.from(normalizeForScoring(reference).replace(/ /g, '')),
    Array.from(normalizeForScoring(hypothesis).replace(/ /g, '')),
  );
  const refChars = Array.from(normalizeForScoring(reference).replace(/ /g, '')).length;
  const count = (k: AlignOp['op']) => words.ops.filter((o) => o.op === k).length;
  return {
    wer: ref.length ? words.distance / ref.length : hyp.length ? 1 : 0,
    cer: refChars ? chars.distance / refChars : hyp.length ? 1 : 0,
    referenceWords: ref.length,
    substitutions: count('sub'),
    deletions: count('del'),
    insertions: count('ins'),
    ops: words.ops,
  };
}

/** True when one text is mostly Devanagari and the other mostly Latin (scores would be meaningless). */
export function scriptMismatch(a: string, b: string): boolean {
  const dev = (s: string) => (s.match(/[ऀ-ॿ]/g) ?? []).length;
  const lat = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length;
  const kind = (s: string) => (dev(s) > lat(s) * 2 ? 'dev' : lat(s) > dev(s) * 2 ? 'lat' : 'mixed');
  const ka = kind(a),
    kb = kind(b);
  return ka !== 'mixed' && kb !== 'mixed' && ka !== kb;
}
