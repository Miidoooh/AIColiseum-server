import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModelPool } from '../agents/roster';
import type { BurnLedger } from '../chain/ledger';
import { getHolding, isWalletAddress, verifyBurn, verifyWalletSignature, type Rpc } from '../chain/solana';
import { CallBook, callWindow, validatePicks } from '../crowd/calls';
import { GladiatorRegistry, gladiatorProfile, publicGladiator, validateGladiator } from '../crowd/gladiators';
import type { TokenInfo } from '../crowd/token-config';
import type { WardenDesk } from '../crowd/warden';
import type { MatchStore } from '../match/store';
import { callMessage, parseGladiatorMemo } from '../shared/crowd';
import type { LiveHub } from './hub';
import { HttpError, RateLimiter, clientIp, readJson } from './request';

export interface CrowdDeps {
  rpc: Rpc;
  token: TokenInfo;
  ledger: BurnLedger;
  warden: WardenDesk;
  calls: CallBook;
  gladiators: GladiatorRegistry;
  hub: LiveHub;
  store: MatchStore;
  pool: ModelPool;
  season: number;
  verify?: typeof verifyBurn;
  holding?: typeof getHolding;
}

type Send = (res: ServerResponse, body: unknown, status?: number) => void;

function decodeSignature(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > 200) throw new HttpError(400, 'Missing wallet signature.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 64) throw new HttpError(400, 'Malformed wallet signature.');
  return bytes;
}

function txSignature(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(value)) throw new HttpError(400, 'Missing burn transaction signature.');
  return value;
}

/** Holder features: Pay the Warden, Call it, and Open Arena gladiators. Returns false when the path is not ours. */
export function createCrowdRoutes(deps: CrowdDeps, send: Send) {
  const verify = deps.verify ?? verifyBurn;
  const holding = deps.holding ?? getHolding;
  const limiter = new RateLimiter(12, 60_000);

  const houseNames = new Set(deps.pool.pool.map((e) => e.name.toLowerCase()));
  const models = new Map(deps.pool.pool.map((e) => [e.model, e.label] as const));

  const post = async (req: IncomingMessage) => {
    if (!limiter.allow(clientIp(req))) throw new HttpError(429, 'Too many requests. Wait a minute and try again.');
    return readJson(req);
  };

  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> => {
    const method = req.method ?? 'GET';
    if (path === '/api/token' && method === 'GET') {
      send(res, await deps.token.view());
      return true;
    }
    if (path === '/api/chain/blockhash' && method === 'GET') {
      const r = await deps.rpc.call<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      send(res, r.value);
      return true;
    }
    if (path === '/api/warden' && method === 'POST') {
      const body = (await post(req)) as { signature?: unknown };
      send(res, await deps.warden.redeem(txSignature(body.signature), deps.hub.status()));
      return true;
    }
    if (path === '/api/calls/window' && method === 'GET') {
      send(res, callWindow(deps.hub.status(), deps.season, deps.token.config.callItLockRound));
      return true;
    }
    if (path === '/api/calls/leaderboard' && method === 'GET') {
      send(res, (await deps.calls.leaderboard()).slice(0, 50));
      return true;
    }
    if (path === '/api/calls' && method === 'POST') {
      const body = (await post(req)) as { wallet?: unknown; picks?: unknown; signature?: unknown };
      const wallet = typeof body.wallet === 'string' ? body.wallet : '';
      if (!isWalletAddress(wallet)) throw new HttpError(400, 'Connect a Solana wallet first.');
      const window = callWindow(deps.hub.status(), deps.season, deps.token.config.callItLockRound);
      if (!window.open || !window.match) throw new HttpError(409, window.reason ?? 'Calls are closed right now.');
      const picks = validatePicks(body.picks, new Set(window.candidates.map((c) => c.id)));
      if (typeof picks === 'string') throw new HttpError(400, picks);
      const message = callMessage({ season: deps.season, match: window.match, wallet, picks });
      if (!verifyWalletSignature(wallet, message, decodeSignature(body.signature))) throw new HttpError(401, 'The wallet signature does not match these picks.');
      const held = await holding(deps.rpc, wallet, deps.token.config.mint);
      const need = deps.token.config.callItMinimumHolding;
      if (held < need) throw new HttpError(403, `Hold at least ${need.toLocaleString('en-US')} tokens to make calls. This wallet holds ${Math.floor(held).toLocaleString('en-US')}.`);
      await deps.calls.submit({ wallet, match: window.match, picks, at: Date.now() });
      send(res, { ok: true, match: window.match });
      return true;
    }
    if (path === '/api/gladiators' && method === 'GET') {
      send(res, (await deps.gladiators.list()).map(publicGladiator).sort((a, b) => b.createdAt - a.createdAt));
      return true;
    }
    const one = path.match(/^\/api\/gladiators\/([a-z][a-z0-9]{1,13})$/);
    if (one && method === 'GET') {
      const g = await deps.gladiators.get(one[1]);
      if (!g) throw new HttpError(404, 'No gladiator by that name.');
      const metas = (await deps.store.listMetas()).filter((m) => m.mode === 'open');
      send(res, gladiatorProfile(g, metas));
      return true;
    }
    if (path === '/api/gladiators' && method === 'POST') {
      const body = (await post(req)) as Record<string, unknown>;
      const signature = txSignature(body.signature);
      const taken = new Set([...houseNames, ...(await deps.gladiators.list()).map((g) => g.id)]);
      const input = validateGladiator(body, models, taken);
      if (typeof input === 'string') throw new HttpError(400, input);
      if (await deps.ledger.has(signature)) throw new HttpError(409, 'That burn has already been used.');
      const { decimals } = await deps.token.mintInfo();
      const burn = await verify(deps.rpc, signature, deps.token.config.mint, decimals);
      if (parseGladiatorMemo(burn.memo) !== input.name.toLowerCase()) throw new HttpError(400, `That burn was not made for a gladiator named ${input.name}.`);
      const price = deps.token.config.gladiatorPrice;
      if (burn.amount < price) throw new HttpError(400, `A gladiator costs ${price.toLocaleString('en-US')} tokens; that burn was ${burn.amount.toLocaleString('en-US')}.`);
      if (!(await deps.ledger.claim(signature, `gladiator:${input.name.toLowerCase()}`))) throw new HttpError(409, 'That burn has already been used.');
      const created = await deps.gladiators.create(input, models.get(input.model) ?? input.model, burn);
      send(res, publicGladiator(created), 201);
      return true;
    }
    return false;
  };
}
