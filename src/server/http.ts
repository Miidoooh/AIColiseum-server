import type { IncomingMessage, ServerResponse } from 'node:http';
import { rulesCard } from '../agents/prompt';
import { MATCH_ID, type MatchStore } from '../match/store';
import { ZONE_INFO } from '../shared/arena';
import { RULES, buildSchedule, releaseTicks } from '../shared/rules';
import { buildLeaderboard } from '../stats/leaderboard';
import type { LiveHub } from './hub';
import { serveStatic } from './static';

export interface HttpDeps {
  store: MatchStore;
  hub: LiveHub;
  clientDir: string;
  tickMs: number;
  corsOrigin: string;
}

/** Matches played by real models. Older scripted-bot recordings stay on disk but are never shown. */
async function realMatches(store: MatchStore) {
  return (await store.listMetas()).filter((m) => m.mode !== 'bots');
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(body));
}

function rulesPayload(tickMs: number) {
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
    prompt: rulesCard('{NAME}', 8, config),
    schedule: schedule.filter((e) => e.kind !== 'dawn'),
    rules: RULES,
    zones: ZONE_INFO,
  };
}

export function createHandler(deps: HttpDeps) {
  const rules = rulesPayload(deps.tickMs);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', deps.corsOrigin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Accept, Content-Type' }).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/health') return json(res, { ok: true });
      if (path === '/api/live') return deps.hub.attach(req, res);
      if (path === '/api/status') return json(res, deps.hub.status());
      if (path === '/api/rules') return json(res, rules);
      if (path === '/api/leaderboard') return json(res, buildLeaderboard(await realMatches(deps.store), deps.hub.liveStats()));
      if (path === '/api/matches') return json(res, (await realMatches(deps.store)).slice(0, 50));
      const match = path.match(/^\/api\/matches\/([^/]+)$/);
      if (match) {
        if (!MATCH_ID.test(match[1])) return json(res, { error: 'invalid match id' }, 400);
        const events = await deps.store.loadEvents(match[1]);
        return events ? json(res, { events }) : json(res, { error: 'match not found' }, 404);
      }
      if (path.startsWith('/api/')) return json(res, { error: 'not found' }, 404);
      await serveStatic(res, deps.clientDir, path);
    } catch (err) {
      console.error('[http]', err);
      if (!res.headersSent) json(res, { error: 'internal error' }, 500);
      else res.end();
    }
  };
}
