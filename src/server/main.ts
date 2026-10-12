import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { countAppearances, createEntrants, loadPool, pickLineup, publicEntry, type RosterEntry } from '../agents/roster';
import { Rng, randomSeed } from '../engine/rng';
import { LlmJudge } from '../match/llm-judge';
import { runMatch } from '../match/runner';
import { MatchStore, newMatchId } from '../match/store';
import { buildMeta } from '../stats/match-stats';
import { loadConfig } from './env';
import { createHandler } from './http';
import { LiveHub } from './hub';
import { loadLiveSwitch } from './live-switch';

const config = loadConfig();
const pool = loadPool(config.rosterPath);
const live = loadLiveSwitch(config.liveSwitchPath);
const store = new MatchStore(join(config.dataDir, `season-${live.season}`));
await store.init();
const hub = new LiveHub();
const llmJudge = config.apiKey && config.judgeModel ? new LlmJudge({ apiKey: config.apiKey, model: config.judgeModel }) : null;

const server = createServer(
  createHandler({ store, hub, pool, season: live.season, clientDir: config.clientDir, tickMs: config.tickMs, corsOrigin: config.corsOrigin }),
);
server.listen(config.port, () => {
  const labs = new Set(pool.pool.map((e) => e.lab)).size;
  console.log(`\n  AI Colosseum running on http://localhost:${config.port} · season ${live.season}`);
  console.log(`  Pool: ${pool.pool.length} models from ${labs} labs, ${pool.perMatch} per match, rotating every match`);
  console.log(`  Round length at least ${config.tickMs}ms · lie judge: ${llmJudge ? config.judgeModel : 'rules only'}`);
  console.log(`  Archive: ${store.directory}${config.dataPersistent ? '' : '  (WARNING: not on a volume, recordings are lost on every redeploy)'}\n`);
});

const realMetas = async () => (await store.listMetas()).filter((m) => m.mode !== 'bots');

if (!live.running) {
  console.log('  Paused: config/live.json has "running": false, so no match starts and no model is called.\n');
  hub.offline(live.pausedMessage, 'paused');
} else if (!config.apiKey) {
  const message = 'OPENROUTER_API_KEY is not set on the game server, so no match can start.';
  console.error(`  ${message} Add it to .env (local) or the server's variables (Railway), then restart.\n`);
  hub.offline(message);
} else {
  const apiKey = config.apiKey;
  const rotation = new Rng(randomSeed());
  let nextLineup: RosterEntry[] | null = null;
  for (;;) {
    const matchId = newMatchId();
    const seed = randomSeed();
    const played = await realMetas();
    const lineup = nextLineup ?? pickLineup(pool, countAppearances(played), rotation);
    const number = played.length + 1;
    try {
      const entrants = createEntrants(lineup, { apiKey, maxTokens: config.maxTokens, temperature: config.temperature });
      const events = await runMatch(
        entrants,
        { matchId, seed, mode: 'llm', tickMs: config.tickMs, agentTimeoutMs: config.agentTimeoutMs, season: live.season, number },
        {
          sink: async (e) => {
            await store.append(matchId, e);
            hub.publish(e);
          },
          now: () => Date.now(),
          sleep: (ms) => sleep(ms),
          llmJudge,
          log: (msg) => console.log(`[colosseum] ${msg}`),
        },
      );
      const meta = buildMeta(events);
      if (meta) await store.saveMeta(meta);
    } catch (err) {
      console.error(`[colosseum] match ${matchId} failed:`, err);
    }
    nextLineup = pickLineup(pool, countAppearances(await realMetas()), rotation);
    console.log(`[colosseum] next lineup: ${nextLineup.map((e) => e.label).join(', ')}`);
    hub.intermission(Date.now() + config.intermissionMs, nextLineup.map(publicEntry));
    await sleep(config.intermissionMs);
  }
}
