import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadPool } from '../agents/roster';
import { BurnLedger } from '../chain/ledger';
import { createRpc } from '../chain/solana';
import { CallBook, outcomeOf } from '../crowd/calls';
import { GladiatorRegistry } from '../crowd/gladiators';
import { TokenInfo, loadTokenConfig } from '../crowd/token-config';
import { WardenDesk } from '../crowd/warden';
import { Rng, randomSeed } from '../engine/rng';
import { LlmJudge } from '../match/llm-judge';
import { runMatch } from '../match/runner';
import { MatchStore, newMatchId } from '../match/store';
import { buildMeta } from '../stats/match-stats';
import { createCrowdRoutes } from './crowd-routes';
import { loadConfig } from './env';
import { createHandler } from './http';
import { LiveHub } from './hub';
import { loadLiveSwitch } from './live-switch';
import { planMatch, type PlannedMatch } from './planner';

const config = loadConfig();
const pool = loadPool(config.rosterPath);
const live = loadLiveSwitch(config.liveSwitchPath);
const store = new MatchStore(join(config.dataDir, `season-${live.season}`));
await store.init();
const hub = new LiveHub();
const llmJudge = config.apiKey && config.judgeModel ? new LlmJudge({ apiKey: config.apiKey, model: config.judgeModel }) : null;

const rpc = createRpc(config.solanaRpcUrl);
const token = new TokenInfo(loadTokenConfig(config.tokenConfigPath), rpc, pool);
const ledger = new BurnLedger(join(config.dataDir, 'burns.json'));
const warden = new WardenDesk(rpc, token, ledger);
const calls = new CallBook(join(store.directory, 'calls.json'));
const gladiators = new GladiatorRegistry(join(config.dataDir, 'gladiators.json'));

const json = (res: import('node:http').ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(body));
};
const crowd = createCrowdRoutes({ rpc, token, ledger, warden, calls, gladiators, hub, store, pool, season: live.season }, json);

const server = createServer(
  createHandler({ store, hub, pool, season: live.season, clientDir: config.clientDir, tickMs: config.tickMs, corsOrigin: config.corsOrigin, crowd }),
);
server.listen(config.port, () => {
  const labs = new Set(pool.pool.map((e) => e.lab)).size;
  console.log(`\n  AI Colosseum running on http://localhost:${config.port} · season ${live.season}`);
  console.log(`  Pool: ${pool.pool.length} models from ${labs} labs, ${pool.perMatch} per match, rotating every match`);
  console.log(`  Round length at least ${config.tickMs}ms · lie judge: ${llmJudge ? config.judgeModel : 'rules only'}`);
  console.log(`  Archive: ${store.directory}${config.dataPersistent ? '' : '  (WARNING: not on a volume, recordings are lost on every redeploy)'}`);
  console.log(`  Token: ${token.config.mint} via ${config.solanaRpcUrl}\n`);
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
  const settings = { apiKey: config.apiKey, maxTokens: config.maxTokens, temperature: config.temperature };
  const rotation = new Rng(randomSeed());
  const plan = async (number: number): Promise<PlannedMatch> =>
    planMatch({ number, pool, played: await realMetas(), gladiators: await gladiators.list(), openEvery: token.config.openArenaEvery, rng: rotation });

  let next: PlannedMatch | null = null;
  for (;;) {
    const matchId = newMatchId();
    const seed = randomSeed();
    const number = (await realMetas()).length + 1;
    const planned = next ?? (await plan(number));
    try {
      const events = await runMatch(
        planned.build(settings),
        { matchId, seed, mode: planned.mode, tickMs: config.tickMs, agentTimeoutMs: config.agentTimeoutMs, season: live.season, number },
        {
          sink: async (e) => {
            await store.append(matchId, e);
            hub.publish(e);
          },
          now: () => Date.now(),
          sleep: (ms) => sleep(ms),
          llmJudge,
          log: (msg) => console.log(`[colosseum] ${msg}`),
          takePaidEvents: () => warden.take(),
        },
      );
      const meta = buildMeta(events);
      if (meta) {
        await store.saveMeta(meta);
        const scored = await calls.score(number, outcomeOf(events));
        if (scored) console.log(`[colosseum] scored ${scored} calls for match #${number}`);
      }
    } catch (err) {
      console.error(`[colosseum] match ${matchId} failed:`, err);
    }
    next = await plan((await realMetas()).length + 1);
    console.log(`[colosseum] next (${next.mode === 'open' ? 'Open Arena' : 'research'}): ${next.lineup.map((e) => e.label).join(', ')}`);
    hub.intermission(Date.now() + config.intermissionMs, next.lineup);
    await sleep(config.intermissionMs);
  }
}
