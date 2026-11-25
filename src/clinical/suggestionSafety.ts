import type { MedicineMatcher } from './medicineMatcher';
import { normalize } from './medicineMatcher';

const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred|half|once|twice|thrice|ek|do|teen|char|chaar|paanch|che|saat|aath|nau|das|aadha|dedh|dhai)\b/gi;

function numbers(s: string): string[] {
  const digits = s.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const words = (s.match(NUMBER_WORDS) ?? []).map((w) => w.toLowerCase());
  return [...digits, ...words].sort();
}

function medicines(s: string, m: MedicineMatcher): string[] {
  const words = normalize(s).split(' ').filter(Boolean);
  const found: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length && m.isKnown(`${words[i]} ${words[i + 1]}`)) found.push(`${words[i]} ${words[i + 1]}`);
    else if (m.isKnown(words[i])) found.push(words[i]);
  }
  return found.sort();
}

/** Warnings for a suggested sentence change that touches clinically important parts. */
export function suggestionWarnings(original: string, suggestion: string, matcher: MedicineMatcher): string[] {
  const out: string[] = [];
  if (numbers(original).join('|') !== numbers(suggestion).join('|')) out.push('changes a number or dose');
  if (medicines(original, matcher).join('|') !== medicines(suggestion, matcher).join('|')) out.push('changes a medicine name');
  return out;
}
