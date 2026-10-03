import { describe, expect, it } from 'vitest';
import { normalize, rankCommands, scoreCommand } from '@/lib/command-rank';

const commands = [
  { id: 'overview', title: 'Go to Overview', keywords: ['home', 'dashboard'] },
  { id: 'inbox', title: 'Go to Inbox', keywords: ['discrepancies', 'triage'] },
  { id: 'transactions', title: 'Go to Transactions', keywords: ['silver', 'payments'] },
  { id: 'matches', title: 'Go to Matches', keywords: ['pairs', 'gold'] },
  { id: 'critical', title: 'Inbox: critical discrepancies', keywords: ['severity'] },
  { id: 'theme', title: 'Toggle theme', keywords: ['dark', 'light', 'appearance'] },
  { id: 'density', title: 'Switch to compact density', keywords: ['rows', 'spacing'] },
];

const ids = (q: string) => rankCommands(q, commands).map((c) => c.id);

describe('rankCommands', () => {
  it('keeps declared order for an empty query', () => {
    expect(ids('')).toEqual(commands.map((c) => c.id));
    expect(ids('   ')).toEqual(commands.map((c) => c.id));
  });

  it('prefers prefix and word-start matches over substrings', () => {
    expect(ids('inbox')[0]).toBe('inbox');
    expect(ids('tog')[0]).toBe('theme');
    expect(ids('crit')[0]).toBe('critical');
  });

  it('finds commands by keyword', () => {
    expect(ids('discrepancies')).toContain('inbox');
    expect(ids('dark')).toEqual(['theme']);
    expect(ids('pairs')).toEqual(['matches']);
  });

  it('matches out-of-order characters fuzzily, in order only', () => {
    expect(ids('trnsc')).toEqual(['transactions']);
    expect(ids('xyz')).toEqual([]);
  });

  it('requires every token of a multi-word query', () => {
    expect(ids('inbox critical')).toEqual(['critical']);
    expect(ids('go matches')[0]).toBe('matches');
    expect(ids('go nothing')).toEqual([]);
  });

  it('is case and accent insensitive', () => {
    expect(normalize('  Résumé  DARK ')).toBe('resume dark');
    expect(ids('OVERVIEW')[0]).toBe('overview');
  });

  it('scores exact titles highest and respects the limit', () => {
    const exact = scoreCommand('toggle theme', commands[5]) as number;
    const partial = scoreCommand('toggle', commands[5]) as number;
    expect(exact).toBeGreaterThan(partial);
    expect(rankCommands('go', commands, 2)).toHaveLength(2);
  });
});
