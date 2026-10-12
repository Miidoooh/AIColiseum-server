import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createEntrants, loadRoster } from '../agents/roster';
import { randomSeed } from '../engine/rng';
import { LlmJudge } from '../match/llm-judge';
import { runMatch } from '../match/runner';
import { MatchStore, newMatchId } from '../match/store';
import { buildMeta } from '../stats/match-stats';
import { loadConfig } from './env';
import { createHandler } from './http';
import { LiveHub } from './hub';

const config = loadConfig();
const roster = loadRoster(config.rosterPath);
const store = new MatchStore(config.dataDir);
await store.init();
const hub = new LiveHub();
const llmJudge = config.apiKey && config.judgeModel ? new LlmJudge({ apiKey: config.apiKey, model: config.judgeModel }) : null;

const server = createServer(createHandler({ store, hub, clientDir: config.clientDir, tickMs: config.tickMs, corsOrigin: config.corsOrigin }));
server.listen(config.port, () => {
  console.log(`\n  AI Colosseum running on http://localhost:${config.port}`);
  console.log(`  Fighters: ${roster.map((r) => `${r.name} (${r.label})`).join(', ')}`);
  console.log(`  Round length at least ${config.tickMs}ms · lie judge: ${llmJudge ? config.judgeModel : 'rules only'}\n`);
});

if (!config.apiKey) {
  const message = 'OPENROUTER_API_KEY is not set on the game server, so no match can start.';
  console.error(`  ${message} Add it to .env (local) or the server's variables (Railway), then restart.\n`);
  hub.offline(message);
} else {
  const apiKey = config.apiKey;
  for (;;) {
    const matchId = newMatchId();
    const seed = randomSeed();
    try {
      const entrants = createEntrants(roster, { apiKey, maxTokens: config.maxTokens, temperature: config.temperature });
      const events = await runMatch(
        entrants,
        { matchId, seed, mode: 'llm', tickMs: config.tickMs, agentTimeoutMs: config.agentTimeoutMs },
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
    hub.intermission(Date.now() + config.intermissionMs);
    await sleep(config.intermissionMs);
  }
}
