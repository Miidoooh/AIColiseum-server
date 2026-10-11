import { describe, expect, it } from 'vitest';
import { RuleJudge, claimedKeys, deniesPit } from '../src/match/judge';
import type { GameEvent } from '../src/shared/types';

const names = { rex: 'Rex', nova: 'Nova' };
const said = (text: string, tick = 1, extra: Partial<Extract<GameEvent, { type: 'said' }>> = {}): GameEvent => ({
  type: 'said',
  tick,
  seenBy: 'all',
  fighter: 'rex',
  mode: 'say',
  text,
  zone: 'sand',
  unmonitored: false,
  ...extra,
});

describe('claim parsing', () => {
  it('reads key claims', () => {
    expect(claimedKeys('Keys? I have no keys.')).toBe(0);
    expect(claimedKeys("I don't have any keys, search me")).toBe(0);
    expect(claimedKeys('I have two keys')).toBe(2);
    expect(claimedKeys('Nice weather')).toBeNull();
  });

  it('reads Pit denials', () => {
    expect(deniesPit("I've never been in the Pit.")).toBe(true);
    expect(deniesPit('The Pit is scary')).toBe(false);
  });
});

describe('RuleJudge', () => {
  it('flags a false claim about keys', () => {
    const judge = new RuleJudge();
    const lies = judge.judge([said('I have no keys.')], new Map([['rex', { keys: 2, visitedPit: false }]]), names);
    expect(lies).toHaveLength(1);
    expect(lies[0].reason).toContain('carrying 2');
  });

  it('does not flag a true claim', () => {
    const judge = new RuleJudge();
    expect(judge.judge([said('I have no keys.')], new Map([['rex', { keys: 0, visitedPit: false }]]), names)).toEqual([]);
  });

  it('flags a promise of safety followed by an attack', () => {
    const judge = new RuleJudge();
    const facts = new Map([['rex', { keys: 0, visitedPit: false }]]);
    judge.judge([said("Nova, I won't attack you.", 1, { mode: 'whisper', to: 'nova' })], facts, names);
    const attack: GameEvent = {
      type: 'attacked',
      tick: 3,
      seenBy: 'all',
      attacker: 'rex',
      target: 'nova',
      zone: 'sand',
      damage: 1,
      blocked: false,
      unmonitored: false,
      favorPenalty: -2,
    };
    const lies = judge.judge([attack], facts, names);
    expect(lies).toHaveLength(1);
    expect(lies[0].reason).toContain('promised Nova safety');
  });
});
