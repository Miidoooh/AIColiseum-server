import type { IncomingMessage, ServerResponse } from 'node:http';
import { rulesCard } from '../agents/prompt';
import { publicEntry, type ModelPool } from '../agents/roster';
import { MATCH_ID, type MatchStore } from '../match/store';
import { ZONE_INFO } from '../shared/arena';
import { RULES, buildSchedule, releaseTicks } from '../shared/rules';
import { buildLeaderboard } from '../stats/leaderboard';
import { summarizeSeason } from '../stats/season';
import type { LiveHub } from './hub';
import { HttpError } from './request';
import { serveStatic } from './static';

export type CrowdHandler = (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>;

export interface HttpDeps {
  store: MatchStore;
  hub: LiveHub;
  pool: ModelPool;
  season: number;
  clientDir: string;
  tickMs: number;
  corsOrigin: string;
  crowd?: CrowdHandler;
}

/** Matches played by real models. Older scripted-bot recordings stay on disk but are never shown. */
async function realMatches(store: MatchStore) {
  return (await store.listMetas()).filter((m) => m.mode !== 'bots');
}

/** The research leaderboard counts only matches between the house AIs, untouched by gladiators. */
async function researchMatches(store: MatchStore) {
  return (await store.listMetas()).filter((m) => m.mode === 'llm');
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(body));
}

function rulesPayload(tickMs: number, pool: ModelPool) {
  const schedule = buildSchedule();
  const config = {
    maxTicks: RULES.maxTicks,
    tickMs,
    releaseTicks: releaseTicks(schedule),
    escapeSlots: RULES.escapeSlots,
    keysToEscape: RULES.keysToEscape,
    dawnEvery: RULES.dawnEvery,
    maxHp: RULES.maxHp,
  };
  return {
    prompt: rulesCard('{NAME}', pool.perMatch, config),
    schedule: schedule.filter((e) => e.kind !== 'dawn'),
    rules: RULES,
    zones: ZONE_INFO,
    perMatch: pool.perMatch,
    roster: pool.pool.map(publicEntry),
  };
}

export function createHandler(deps: HttpDeps) {
  const rules = rulesPayload(deps.tickMs, deps.pool);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', deps.corsOrigin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, POST', 'Access-Control-Allow-Headers': 'Accept, Content-Type' }).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, HEAD, POST' }).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (deps.crowd && path.startsWith('/api/') && (await deps.crowd(req, res, path))) return;
      if (req.method === 'POST') return json(res, { error: 'not found' }, 404);
      if (path === '/health') return json(res, { ok: true });
      if (path === '/api/live') return deps.hub.attach(req, res);
      if (path === '/api/status') return json(res, deps.hub.status());
      if (path === '/api/rules') return json(res, rules);
      if (path === '/api/season') {
        const status = deps.hub.status();
        const current = status.phase === 'running' ? status.matchNumber : null;
        return json(res, summarizeSeason(deps.season, deps.pool.perMatch, await realMatches(deps.store), current));
      }
      if (path === '/api/leaderboard') {
        const live = deps.hub.status().mode === 'llm' ? deps.hub.liveStats() : null;
        return json(res, buildLeaderboard(await researchMatches(deps.store), live));
      }
      if (path === '/api/matches') return json(res, (await realMatches(deps.store)).slice(0, 50));
      if (path === '/api/archive') {
        const matches = await realMatches(deps.store);
        res.setHeader('Content-Disposition', `attachment; filename="ai-colosseum-season-${deps.season}-archive.json"`);
        return json(res, {
          season: deps.season,
          exportedAt: new Date().toISOString(),
          summary: summarizeSeason(deps.season, deps.pool.perMatch, matches, null),
          leaderboard: buildLeaderboard(matches),
          matches,
          fullLogs: 'Every match log: /api/matches/<id>/download (one JSON event per line)',
        });
      }
      const download = path.match(/^\/api\/matches\/([^/]+)\/download$/);
      if (download) {
        if (!MATCH_ID.test(download[1])) return json(res, { error: 'invalid match id' }, 400);
        const raw = await deps.store.loadRaw(download[1]);
        if (raw === null) return json(res, { error: 'match not found' }, 404);
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition': `attachment; filename="ai-colosseum-${download[1]}.jsonl"`,
          'Cache-Control': 'no-cache',
        });
        res.end(raw);
        return;
      }
      const match = path.match(/^\/api\/matches\/([^/]+)$/);
      if (match) {
        if (!MATCH_ID.test(match[1])) return json(res, { error: 'invalid match id' }, 400);
        const events = await deps.store.loadEvents(match[1]);
        return events ? json(res, { events }) : json(res, { error: 'match not found' }, 404);
      }
      if (path.startsWith('/api/')) return json(res, { error: 'not found' }, 404);
      await serveStatic(res, deps.clientDir, path);
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return json(res, { error: err.message }, err.status);
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Solana RPC')) return json(res, { error: 'Solana is not answering right now. Try again in a minute.' }, 502);
      if (req.method === 'POST' && err instanceof Error) return json(res, { error: message }, 400);
      console.error('[http]', err);
      json(res, { error: 'internal error' }, 500);
    }
  };
}
