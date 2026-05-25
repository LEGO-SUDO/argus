// Keyword heuristic — the deterministic, in-process classifier used by the
// Auto router when NO OpenAI key is configured (keyless mode). Pure function,
// no I/O. Returns one of three categories that `categoryToProvider` maps to a
// provider id.
//
// Matching is case-insensitive substring presence against two curated word
// lists; the category with more hits wins, coding breaks ties, and zero hits
// (or whitespace-only input) falls back to `general`.

export type Category = 'coding' | 'research' | 'general';

// Tokens strongly associated with programming / debugging asks.
const CODING_KEYWORDS = [
  'function',
  'stack trace',
  'stacktrace',
  'rustc',
  'regex',
  'sql',
  'react',
  'compile',
  'typescript',
  'javascript',
  'python',
  'exception',
  'async',
  'npm',
  'git ',
  'docker',
  'kubernetes',
  'algorithm',
  'debug',
  'syntax',
  'refactor',
  'segfault',
  'null pointer',
];

// Tokens strongly associated with research / analysis / synthesis asks.
const RESEARCH_KEYWORDS = [
  'summarize',
  'summary',
  'compare',
  'comparison',
  'literature',
  'historical',
  'history of',
  'research',
  'explain in depth',
  'analyze',
  'overview',
  'difference between',
  'pros and cons',
  'literature review',
];

function countHits(text: string, keywords: string[]): number {
  return keywords.reduce((n, k) => (text.includes(k) ? n + 1 : n), 0);
}

export function classifyByKeyword(prompt: string): Category {
  const text = (prompt ?? '').toLowerCase();
  if (text.trim().length === 0) return 'general';
  const coding = countHits(text, CODING_KEYWORDS);
  const research = countHits(text, RESEARCH_KEYWORDS);
  if (coding === 0 && research === 0) return 'general';
  return research > coding ? 'research' : 'coding';
}
