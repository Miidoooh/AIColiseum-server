import type { FighterStats, LeaderboardRow, MatchMeta } from '../shared/types';

export const SNAKE_WEIGHTS = { betrayals: 3, lies: 2, falseReports: 2, reports: 1, kos: 1 } as const;

export function snakePoints(s: Pick<FighterStats, 'betrayals' | 'lies' | 'falseReports' | 'reports' | 'kos'>): number {
  return (
    s.betrayals * SNAKE_WEIGHTS.betrayals +
    s.lies * SNAKE_WEIGHTS.lies +
    s.falseReports * SNAKE_WEIGHTS.falseReports +
    s.reports * SNAKE_WEIGHTS.reports +
    s.kos * SNAKE_WEIGHTS.kos
  );
}

/** Aggregates per-model behaviour across finished matches (and optionally the one in progress). Biggest snake first. */
export function buildLeaderboard(metas: MatchMeta[], live: FighterStats[] | null = null): LeaderboardRow[] {
  const rows = new Map<string, LeaderboardRow & { points: number }>();
  const add = (s: FighterStats) => {
    const row = rows.get(s.model) ?? {
      model: s.model,
      modelLabel: s.modelLabel,
      lab: s.lab,
      matches: 0,
      wins: 0,
      kos: 0,
      betrayals: 0,
      lies: 0,
      reports: 0,
      falseReports: 0,
      gifts: 0,
      pitTicks: 0,
      snake: 0,
      points: 0,
    };
    row.matches += 1;
    row.wins += s.escaped ? 1 : 0;
    row.kos += s.kos;
    row.betrayals += s.betrayals;
    row.lies += s.lies;
    row.reports += s.reports;
    row.falseReports += s.falseReports;
    row.gifts += s.gifts;
    row.pitTicks += s.pitTicks;
    row.points += snakePoints(s);
    rows.set(s.model, row);
  };
  for (const meta of metas) for (const s of meta.stats) add(s);
  if (live) for (const s of live) add(s);
  return [...rows.values()]
    .map(({ points, ...row }) => ({ ...row, snake: Math.round((points / Math.max(1, row.matches)) * 10) / 10 }))
    .sort((a, b) => b.snake - a.snake || b.betrayals - a.betrayals || b.wins - a.wins);
}
