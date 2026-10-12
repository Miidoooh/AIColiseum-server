import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BurnLedger } from '../src/chain/ledger';
import type { VerifiedBurn } from '../src/chain/solana';
import { CallBook, callWindow, scoreCall, validatePicks } from '../src/crowd/calls';
import { validateGladiator } from '../src/crowd/gladiators';
import type { TokenInfo } from '../src/crowd/token-config';
import { WardenDesk } from '../src/crowd/warden';
import { applyPaidEvent } from '../src/engine/schedule';
import type { LiveStatus } from '../src/shared/types';
import { fighter, makeState } from './helpers';

const tmp = () => mkdtempSync(join(tmpdir(), 'colosseum-'));

const status = (over: Partial<LiveStatus> = {}): LiveStatus => ({
  phase: 'running',
  message: null,
  matchId: 'm-1',
  season: 1,
  matchNumber: 3,
  mode: 'llm',
  tick: 2,
  maxTicks: 90,
  fighters: [],
  nextMatchAt: null,
  nextLineup: null,
  ...over,
});

const token = {
  config: { mint: 'MINT', warden: { blackout: 50000, supply_drop: 25000, rations_cut: 25000, bounty: 40000 } },
  mintInfo: async () => ({ decimals: 6, program: 'Tokenz' }),
} as unknown as TokenInfo;

const burn = (memo: string, amount = 50000): VerifiedBurn => ({ signature: 'sig', owner: '7xQabcdefghijk2', amount, memo, blockTime: null });

describe('Pay the Warden', () => {
  it('queues a verified, fully paid burn and refuses to redeem it twice', async () => {
    const desk = new WardenDesk({ call: vi.fn() }, token, new BurnLedger(join(tmp(), 'burns.json')), vi.fn(async () => burn('AICOLOSSEUM:WARDEN:blackout')));
    const receipt = await desk.redeem('sig-1', status());
    expect(receipt).toMatchObject({ action: 'blackout', payer: '7xQa…ijk2', burned: 50000 });
    expect(desk.take()).toEqual([{ kind: 'blackout', payer: receipt.payer }]);
    await expect(desk.redeem('sig-1', status())).rejects.toThrow(/already been used/);
  });

  it('rejects burns that are too small or not meant for the Warden', async () => {
    const small = new WardenDesk({ call: vi.fn() }, token, new BurnLedger(join(tmp(), 'b.json')), vi.fn(async () => burn('AICOLOSSEUM:WARDEN:blackout', 10)));
    await expect(small.redeem('s', status())).rejects.toThrow(/costs 50,000/);
    const other = new WardenDesk({ call: vi.fn() }, token, new BurnLedger(join(tmp(), 'b.json')), vi.fn(async () => burn('gm')));
    await expect(other.redeem('s', status())).rejects.toThrow(/not marked/);
  });

  it('applies a paid event with the payer named in the feed', () => {
    const state = makeState();
    state.tick = 5;
    const events = applyPaidEvent(state, { kind: 'bounty', target: 'kai', payer: '7xQa…k2' });
    expect(fighter(state, 'kai').bounty).toBe(true);
    const warden = events.find((e) => e.type === 'warden');
    expect(warden).toMatchObject({ paidBy: '7xQa…k2' });
    expect(warden?.type === 'warden' && warden.text.startsWith('7xQa…k2 paid the Warden.')).toBe(true);
  });
});

describe('Call it', () => {
  const lineup = ['GPT', 'Claude', 'Grok'].map((name) => ({ name, color: '#fff', model: name, label: name, lab: 'x' }));

  it('opens for the announced lineup during the break and closes after the lock round', () => {
    const brk = callWindow(status({ phase: 'intermission', nextLineup: lineup }), 1, 10);
    expect(brk).toMatchObject({ open: true, match: 4 });
    expect(brk.candidates.map((c) => c.id)).toEqual(['gpt', 'claude', 'grok']);
    expect(callWindow(status({ tick: 12 }), 1, 10).open).toBe(false);
  });

  it('validates picks against the fighters in the match', () => {
    const ids = new Set(['gpt', 'claude', 'grok']);
    expect(validatePicks({ escape: ['gpt'], firstBetrayal: 'grok', snake: 'claude' }, ids)).toEqual({ escape: ['gpt'], firstBetrayal: 'grok', snake: 'claude' });
    expect(validatePicks({ escape: ['gpt', 'claude', 'grok'], firstBetrayal: 'grok', snake: 'gpt' }, ids)).toMatch(/one or two/);
    expect(validatePicks({ escape: ['nobody'], firstBetrayal: 'grok', snake: 'gpt' }, ids)).toMatch(/not in this match/);
  });

  it('scores calls and ranks callers', async () => {
    expect(scoreCall({ escape: ['gpt', 'grok'], firstBetrayal: 'claude', snake: 'claude' }, { escaped: ['gpt'], firstBetrayal: 'claude', snake: 'grok' })).toEqual({ points: 8, hits: 2 });
    const book = new CallBook(join(tmp(), 'calls.json'));
    await book.submit({ wallet: 'A', match: 1, picks: { escape: ['gpt'], firstBetrayal: 'grok', snake: 'grok' }, at: 1 });
    await book.submit({ wallet: 'B', match: 1, picks: { escape: ['claude'], firstBetrayal: 'gpt', snake: 'gpt' }, at: 2 });
    expect(await book.score(1, { escaped: ['gpt'], firstBetrayal: 'grok', snake: null })).toBe(2);
    expect(await book.score(1, { escaped: [], firstBetrayal: null, snake: null })).toBe(0);
    const board = await book.leaderboard();
    expect(board[0]).toMatchObject({ wallet: 'A', points: 8, hits: 2 });
  });
});

describe('gladiators', () => {
  const models = new Map([['openai/gpt-6.1-sol', 'GPT-6.1 Sol']]);
  const valid = { name: 'Brutus', color: '#ff6b6b', model: 'openai/gpt-6.1-sol', persona: 'A loyal old soldier who never forgets a debt.', strategy: '' };

  it('accepts a well-formed gladiator', () => {
    expect(validateGladiator(valid, models, new Set())).toMatchObject({ name: 'Brutus', model: 'openai/gpt-6.1-sol' });
  });

  it('rejects taken names, unknown models and empty personalities', () => {
    expect(validateGladiator(valid, models, new Set(['brutus']))).toMatch(/taken/);
    expect(validateGladiator({ ...valid, model: 'x/unknown' }, models, new Set())).toMatch(/listed models/);
    expect(validateGladiator({ ...valid, persona: 'hi' }, models, new Set())).toMatch(/personality/);
    expect(validateGladiator({ ...valid, name: 'two words' }, models, new Set())).toMatch(/one word/);
  });
});
