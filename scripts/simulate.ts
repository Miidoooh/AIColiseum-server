/** Runs bot matches headlessly and prints how dramatic they were. Usage: npm run simulate -- 20 */
import { BOT_STYLES, BotAgent } from '../src/agents/bot-agent';
import { runMatch } from '../src/match/runner';
import { buildLeaderboard } from '../src/stats/leaderboard';
import { buildMeta } from '../src/stats/match-stats';
import type { GameEvent, MatchMeta } from '../src/shared/types';

const runs = Number(process.argv[2] ?? 10);
const metas: MatchMeta[] = [];

for (let i = 0; i < runs; i++) {
  const seed = 1000 + i;
  const entrants = BOT_STYLES.map((style, j) => ({
    model: `bot/${style}`,
    modelLabel: style,
    lab: 'Demo',
    agent: new BotAgent(style, seed * 31 + j),
  }));
  const log = await runMatch(entrants, { matchId: `m-sim-${i}`, seed, mode: 'bots', tickMs: 0, agentTimeoutMs: 1000 }, {
    sink: () => {},
    now: () => 0,
    sleep: async () => {},
  });
  const count = (type: GameEvent['type']) => log.filter((e) => e.type === type).length;
  const meta = buildMeta(log)!;
  metas.push(meta);
  const winners = log.filter((e) => e.type === 'escaped').map((e) => (e.type === 'escaped' ? `${e.fighter}:${e.route}` : ''));
  console.log(
    `#${i} ticks=${meta.ticks} said=${count('said')} attacks=${count('attacked')} kos=${count('knocked_out')} betrayals=${count('betrayal')} lies=${count('lie')} reports=${count('reported')} pacts=${count('pact_formed')} escaped=[${winners.join(', ')}] — ${meta.reason}`,
  );
}

console.log('\nLeaderboard');
for (const row of buildLeaderboard(metas)) {
  console.log(`${row.modelLabel.padEnd(10)} snake=${String(row.snake).padStart(5)} wins=${row.wins} betrayals=${row.betrayals} lies=${row.lies} kos=${row.kos} reports=${row.reports}`);
}
