import { mkdtempSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadPool } from '../src/agents/roster';
import { BurnLedger } from '../src/chain/ledger';
import { CallBook } from '../src/crowd/calls';
import { GladiatorRegistry } from '../src/crowd/gladiators';
import type { TokenInfo } from '../src/crowd/token-config';
import { WardenDesk } from '../src/crowd/warden';
import type { MatchStore } from '../src/match/store';
import { createCrowdRoutes } from '../src/server/crowd-routes';
import type { LiveHub } from '../src/server/hub';
import { callMessage, gladiatorMemo } from '../src/shared/crowd';
import type { LiveStatus } from '../src/shared/types';
import { makeWallet } from './chain.test';

const pool = loadPool(fileURLToPath(new URL('../config/roster.json', import.meta.url)));
const dir = () => mkdtempSync(join(tmpdir(), 'colosseum-routes-'));

function request(method: string, body?: unknown): IncomingMessage {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { method, headers: {}, socket: { remoteAddress: '127.0.0.1' } });
  return req;
}

function setup(status: Partial<LiveStatus>, opts: { holding?: number; burn?: { memo: string; amount: number } } = {}) {
  const d = dir();
  const token = {
    config: { mint: 'MINT', warden: { blackout: 1, supply_drop: 1, rations_cut: 1, bounty: 1 }, callItMinimumHolding: 10000, callItLockRound: 10, gladiatorPrice: 250000 },
    mintInfo: async () => ({ decimals: 6, program: 'Tokenz' }),
    view: async () => ({}),
  } as unknown as TokenInfo;
  const ledger = new BurnLedger(join(d, 'burns.json'));
  const hub = { status: () => ({ phase: 'running', message: null, matchId: 'm', season: 1, matchNumber: 2, mode: 'llm', tick: 1, maxTicks: 90, fighters: [], nextMatchAt: null, nextLineup: null, ...status }) } as unknown as LiveHub;
  const verify = vi.fn(async () => ({ signature: 'x', owner: 'OwnerWallet1111111111111111111111', amount: opts.burn?.amount ?? 0, memo: opts.burn?.memo ?? '', blockTime: null }));
  const sent: { body: unknown; status: number }[] = [];
  const routes = createCrowdRoutes(
    {
      rpc: { call: vi.fn() },
      token,
      ledger,
      warden: new WardenDesk({ call: vi.fn() }, token, ledger, verify),
      calls: new CallBook(join(d, 'calls.json')),
      gladiators: new GladiatorRegistry(join(d, 'gladiators.json')),
      hub,
      store: { listMetas: async () => [] } as unknown as MatchStore,
      pool,
      season: 1,
      verify,
      holding: vi.fn(async () => opts.holding ?? 0),
    },
    (_res, body, status = 200) => sent.push({ body, status }),
  );
  return { routes, sent };
}

const res = {} as ServerResponse;
const fighters = ['gpt', 'claude', 'grok'].map((id) => ({ id, name: id, modelLabel: id, color: '#fff' }));
const BURN_SIG = '5'.repeat(88);

describe('crowd routes', () => {
  it('records a signed call from a holder', async () => {
    const { routes, sent } = setup({ fighters: fighters as never }, { holding: 20000 });
    const wallet = makeWallet();
    const picks = { escape: ['gpt'], firstBetrayal: 'grok', snake: 'claude' };
    const signature = Buffer.from(wallet.sign(callMessage({ season: 1, match: 2, wallet: wallet.address, picks }))).toString('base64');
    expect(await routes(request('POST', { wallet: wallet.address, picks, signature }), res, '/api/calls')).toBe(true);
    expect(sent[0]).toEqual({ body: { ok: true, match: 2 }, status: 200 });
  });

  it('refuses calls from wallets that do not hold enough', async () => {
    const { routes } = setup({ fighters: fighters as never }, { holding: 5 });
    const wallet = makeWallet();
    const picks = { escape: ['gpt'], firstBetrayal: 'grok', snake: 'claude' };
    const signature = Buffer.from(wallet.sign(callMessage({ season: 1, match: 2, wallet: wallet.address, picks }))).toString('base64');
    await expect(routes(request('POST', { wallet: wallet.address, picks, signature }), res, '/api/calls')).rejects.toThrow(/Hold at least 10,000/);
  });

  it('refuses a call whose signature covers different picks', async () => {
    const { routes } = setup({ fighters: fighters as never }, { holding: 20000 });
    const wallet = makeWallet();
    const signed = Buffer.from(wallet.sign(callMessage({ season: 1, match: 2, wallet: wallet.address, picks: { escape: ['grok'], firstBetrayal: 'grok', snake: 'grok' } }))).toString('base64');
    const body = { wallet: wallet.address, picks: { escape: ['gpt'], firstBetrayal: 'grok', snake: 'claude' }, signature: signed };
    await expect(routes(request('POST', body), res, '/api/calls')).rejects.toThrow(/signature does not match/);
  });

  it('creates a gladiator from a burn made for that name', async () => {
    const { routes, sent } = setup({}, { burn: { memo: gladiatorMemo('Brutus'), amount: 250000 } });
    const body = { signature: BURN_SIG, name: 'Brutus', color: '#ff6b6b', model: pool.pool[0].model, persona: 'A loyal soldier who never forgets a debt.', strategy: 'Guard allies.' };
    await routes(request('POST', body), res, '/api/gladiators');
    expect(sent[0].status).toBe(201);
    expect(sent[0].body).toMatchObject({ id: 'brutus', name: 'Brutus', owner: 'OwnerWallet1111111111111111111111' });
    await expect(routes(request('POST', body), res, '/api/gladiators')).rejects.toThrow(/taken|already been used/);
  });

  it('refuses a gladiator when the burn was for another name or too small', async () => {
    const wrongName = setup({}, { burn: { memo: gladiatorMemo('Cassia'), amount: 250000 } });
    const body = { signature: BURN_SIG, name: 'Brutus', color: '#ff6b6b', model: pool.pool[0].model, persona: 'A loyal soldier who never forgets a debt.' };
    await expect(wrongName.routes(request('POST', body), res, '/api/gladiators')).rejects.toThrow(/not made for a gladiator named Brutus/);
    const small = setup({}, { burn: { memo: gladiatorMemo('Brutus'), amount: 10 } });
    await expect(small.routes(request('POST', body), res, '/api/gladiators')).rejects.toThrow(/costs 250,000/);
  });

  it('leaves unknown paths to the main handler', async () => {
    const { routes } = setup({});
    expect(await routes(request('GET'), res, '/api/status')).toBe(false);
  });
});
