import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../src/agents/agent';
import { BOT_STYLES, BotAgent } from '../src/agents/bot-agent';
import type { Entrant } from '../src/agents/roster';
import { runMatch } from '../src/match/runner';
import { buildLeaderboard } from '../src/stats/leaderboard';
import { buildMeta } from '../src/stats/match-stats';
import type { GameEvent } from '../src/shared/types';

const waitingAgent = (): Agent => ({
  kind: 'bot',
  decide: vi.fn(async () => ({ action: { note: 'waiting', messages: [], offerPact: [], breakPact: [], action: { type: 'wait' as const } }, raw: '' })),
});

const entrant = (agent: Agent, i: number): Entrant => ({ model: `mock/${i}`, modelLabel: `Mock ${i}`, lab: 'Mock', agent });

const deps = (sink: (e: GameEvent) => void) => ({ sink, now: () => 0, sleep: async () => {} });

describe('runMatch', () => {
  it('streams every event to the sink in order and ends the match', async () => {
    const sink = vi.fn();
    const agents = Array.from({ length: 4 }, waitingAgent);
    const log = await runMatch(
      agents.map(entrant),
      { matchId: 'm-test', seed: 1, mode: 'bots', tickMs: 0, agentTimeoutMs: 1000 },
      deps(sink),
    );
    expect(sink).toHaveBeenCalledTimes(log.length);
    expect(log[0].type).toBe('match_started');
    expect(log.at(-1)?.type).toBe('match_ended');
    expect(agents[0].decide).toHaveBeenCalled();
  });

  it('turns a failing agent into a hesitation instead of crashing', async () => {
    const broken: Agent = { kind: 'llm', decide: vi.fn(async () => Promise.reject(new Error('provider down'))) };
    const log = await runMatch(
      [broken, waitingAgent(), waitingAgent()].map(entrant),
      { matchId: 'm-test', seed: 2, mode: 'mixed', tickMs: 0, agentTimeoutMs: 1000 },
      deps(() => {}),
    );
    expect(log.some((e) => e.type === 'idle' && e.reason.includes('provider down'))).toBe(true);
    expect(log.at(-1)?.type).toBe('match_ended');
  });

  it('plays a full eight-bot match that produces drama and a leaderboard', async () => {
    const entrants = BOT_STYLES.map((style, i) => entrant(new BotAgent(style, 100 + i), i));
    const log = await runMatch(
      entrants,
      { matchId: 'm-bots', seed: 7, mode: 'bots', tickMs: 0, agentTimeoutMs: 1000 },
      deps(() => {}),
    );
    const count = (type: GameEvent['type']) => log.filter((e) => e.type === type).length;
    expect(log.at(-1)?.type).toBe('match_ended');
    expect(count('said')).toBeGreaterThan(10);
    expect(count('attacked')).toBeGreaterThan(0);
    const meta = buildMeta(log);
    expect(meta).not.toBeNull();
    const board = buildLeaderboard([meta!]);
    expect(board).toHaveLength(8);
    expect(board[0].snake).toBeGreaterThanOrEqual(board.at(-1)!.snake);
  });
});
