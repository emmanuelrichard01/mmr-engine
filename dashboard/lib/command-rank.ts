// ─── Command palette ranking ─────────────────────────────────────────────────
// Ranks local commands (pages and actions) against what the user typed.
// Deliberately simple and predictable: exact > prefix > word start >
// substring > keyword > in-order fuzzy match. Every token of a multi-word
// query has to match somewhere. Ties keep the commands' declared order.

export interface RankableCommand {
  id: string;
  title: string;
  /** Extra words that should find this command, e.g. "discrepancies" for Inbox. */
  keywords?: readonly string[];
}

export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function wordStarts(text: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (i === 0 || /[\s/:_\-(]/.test(text[i - 1])) starts.push(i);
  }
  return starts;
}

/** In-order character match; rewards consecutive runs and word starts, penalises gaps. */
function fuzzy(token: string, text: string): number | null {
  const starts = new Set(wordStarts(text));
  let score = 0;
  let ti = 0;
  let last = -1;
  for (let i = 0; i < text.length && ti < token.length; i++) {
    if (text[i] !== token[ti]) continue;
    score += 10;
    if (last === i - 1) score += 12;
    if (starts.has(i)) score += 15;
    if (last !== -1) score -= Math.min(i - last - 1, 8);
    last = i;
    ti++;
  }
  return ti === token.length ? score : null;
}

function scoreToken(token: string, title: string, keywords: string[]): number | null {
  if (title === token) return 1000;
  const words = title.split(/[\s/:_\-(]+/);
  // A whole-word hit beats a prefix; among those, the shorter (more specific) title wins.
  if (words.includes(token)) return 900 - Math.min(title.length, 100) / 10;
  if (title.startsWith(token)) return 800 - Math.min(title.length - token.length, 100);
  if (words.some((w) => w.startsWith(token))) return 600;
  const index = title.indexOf(token);
  if (index !== -1) return 400 - Math.min(index, 100);
  if (keywords.some((k) => k === token)) return 350;
  if (keywords.some((k) => k.startsWith(token))) return 300;
  const f = fuzzy(token, title);
  if (f !== null && token.length >= 2) return 100 + f;
  return null;
}

/** Score of one command, or null when it does not match. Empty queries match everything with 0. */
export function scoreCommand(query: string, command: RankableCommand): number | null {
  const q = normalize(query);
  if (!q) return 0;
  const title = normalize(command.title);
  const keywords = (command.keywords ?? []).map(normalize);
  let total = 0;
  for (const token of q.split(' ')) {
    const s = scoreToken(token, title, keywords);
    if (s === null) return null;
    total += s;
  }
  return total;
}

/** Matching commands, best first; stable for equal scores. */
export function rankCommands<T extends RankableCommand>(query: string, commands: readonly T[], limit = Infinity): T[] {
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(query, command) }))
    .filter((r): r is { command: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.command);
}
