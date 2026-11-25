/**
 * Finds words in recognised text that look like a misheard / misread medicine
 * name and proposes the dictionary spelling ("clobetasole" -> "clobetasol",
 * "benzoil peroxide" -> "benzoyl peroxide").
 *
 * It only *suggests*. Many drug names sound alike (hydroxyzine / hydralazine),
 * so a change is always confirmed by the user, never applied silently.
 */

export interface MedicineIssue {
  /** Character range in the text. */
  start: number;
  end: number;
  found: string;
  /** Dictionary spellings, best first. */
  suggestions: string[];
}

interface Entry {
  name: string;
  norm: string;
  key: string;
}

/** Everyday English / Hinglish / prescription words that must never be "corrected". */
const COMMON = new Set(
  (
    'the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did done does said says made went gone got patient patients ' +
    'doctor sir madam please thank thanks hello hi okay ok yes yeah morning evening night today tomorrow yesterday week weeks month months year years days day hours hour minutes daily twice once thrice times time before after food meal meals empty stomach water milk ' +
    'tablet tablets tab capsule capsules cap cream creams ointment gel lotion syrup drops drop injection spray powder soap shampoo serum face wash solution suspension sachet strip ' +
    'mg ml gram grams dose doses morning noon apply applied take taken taking continue stop start started increase decrease reduce review follow up visit test tests report reports blood sugar pressure ' +
    'skin rash itching itch itchy redness red swelling pain fever cold cough headache acne pimples spots patch patches dry oily burning scalp hair nail nails arms arm legs leg hands hand feet foot face body back chest ' +
    'mild moderate severe chronic acute history similar symptoms experiencing complaint complains since both left right upper lower side area areas ' +
    // Hinglish
    'hai hain ho hota hoti hote tha thi the ko ka ki ke se mein me par pe aur ya bhi nahi nahin na mat haan ji kya kyun kab kaise kitna kitni kitne ek do teen char chaar paanch che saat aath nau das ' +
    'din raat subah shaam dopahar roz rozana baar hafte hafta mahine mahina saal khana khane khaana pehle baad lena lene lagana lagaye lagao dawai dawa dawaai goli ' +
    'rahi raha rahe rahe hua hui hue gaya gayi gaye kar karo karna karein karte dena dijiye lijiye wala wali wale abhi phir sirf thoda thodi zyada kam bahut theek accha achha'
  ).split(/\s+/),
);

export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rough sound key for English drug names (ph=f, y=i, c=k/s, z=s, doubled letters, no spaces). */
export function soundKey(s: string): string {
  return normalize(s)
    .replace(/ph/g, 'f')
    .replace(/y/g, 'i')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/ck/g, 'k')
    .replace(/[cq]/g, 'k')
    .replace(/z/g, 's')
    .replace(/x/g, 'ks')
    .replace(/th/g, 't')
    .replace(/ /g, '')
    .replace(/(.)\1+/g, '$1');
}

/** Optimal string alignment distance (Levenshtein + adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const n = a.length,
    m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max ? 1 - editDistance(a, b) / max : 1;
}

function threshold(len: number): number {
  return len >= 9 ? 0.74 : len >= 7 ? 0.78 : 0.84;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

export class MedicineMatcher {
  private entries: Entry[] = [];
  private known = new Set<string>();
  private allowed: Set<string>;

  constructor(names: string[], allowed: string[] = []) {
    const seen = new Set<string>();
    for (const raw of names) {
      const name = raw.trim();
      const norm = normalize(name);
      if (norm.length < 3 || seen.has(norm)) continue;
      seen.add(norm);
      this.entries.push({ name, norm, key: soundKey(name) });
      this.known.add(norm);
      this.known.add(norm.replace(/ /g, ''));
    }
    this.allowed = new Set(allowed.map(normalize));
  }

  get size(): number {
    return this.entries.length;
  }

  isKnown(term: string): boolean {
    return this.known.has(normalize(term));
  }

  private candidates(norm: string): Array<{ name: string; score: number }> {
    const key = soundKey(norm);
    const flat = norm.replace(/ /g, '');
    const out: Array<{ name: string; score: number }> = [];
    for (const e of this.entries) {
      const eFlat = e.norm.replace(/ /g, '');
      if (Math.abs(eFlat.length - flat.length) > Math.max(2, Math.round(eFlat.length * 0.25))) continue;
      if (e.key[0] !== key[0] && e.norm[0] !== norm[0]) continue;
      const score = Math.max(similarity(flat, eFlat), similarity(key, e.key) * 0.97);
      if (score >= threshold(eFlat.length)) out.push({ name: e.name, score });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Returns likely misspelled medicine names (non-overlapping), in text order. */
  check(text: string): MedicineIssue[] {
    if (!this.entries.length || !text) return [];
    const tokens: Token[] = [];
    const re = /[A-Za-z][A-Za-z'-]*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });

    const covered: Array<[number, number]> = [];
    const found: Array<MedicineIssue & { score: number }> = [];
    const overlaps = (a: number, b: number, list: Array<[number, number]>) => list.some(([s, e]) => a < e && b > s);

    for (let n = 3; n >= 1; n--) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const group = tokens.slice(i, i + n);
        // Only consecutive words separated by plain spaces.
        if (group.some((t, k) => k > 0 && !/^ +$/.test(text.slice(group[k - 1].end, t.start)))) continue;
        const start = group[0].start,
          end = group[n - 1].end;
        if (overlaps(start, end, covered)) continue;
        const phrase = text.slice(start, end);
        const norm = normalize(phrase);
        if (this.known.has(norm) || this.known.has(norm.replace(/ /g, ''))) {
          covered.push([start, end]); // correctly spelled medicine
          continue;
        }
        if (this.allowed.has(norm)) continue;
        const words = norm.split(' ');
        if (words.every((w) => COMMON.has(w) || w.length < 3)) continue;
        if (n === 1 && (norm.length < 5 || COMMON.has(norm))) continue;
        if (n > 1 && (COMMON.has(words[0]) || COMMON.has(words[words.length - 1]))) continue;
        const cands = this.candidates(norm);
        if (!cands.length) continue;
        found.push({ start, end, found: phrase, suggestions: cands.slice(0, 3).map((c) => c.name), score: cands[0].score + n * 0.01 });
      }
    }
    found.sort((a, b) => b.score - a.score);
    const accepted: Array<MedicineIssue & { score: number }> = [];
    for (const f of found) {
      if (overlaps(f.start, f.end, covered) || accepted.some((a) => f.start < a.end && f.end > a.start)) continue;
      accepted.push(f);
    }
    return accepted.sort((a, b) => a.start - b.start).map(({ score: _s, ...rest }) => rest);
  }
}

/** Replaces text[start,end) keeping a leading capital letter. */
export function applyMedicineFix(text: string, issue: MedicineIssue, name: string): string {
  const cap = /^[A-Z]/.test(issue.found) ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  return text.slice(0, issue.start) + cap + text.slice(issue.end);
}
