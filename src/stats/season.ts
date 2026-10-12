import type { MatchMeta, SeasonSummary } from '../shared/types';

/** Running totals for the season so far, from finished matches only. */
export function summarizeSeason(season: number, perMatch: number, metas: MatchMeta[], currentMatch: number | null): SeasonSummary {
  const totals = { rounds: 0, betrayals: 0, lies: 0, knockouts: 0, escapes: 0, messages: 0 };
  const appearances: Record<string, number> = {};
  for (const meta of metas) {
    totals.rounds += meta.ticks;
    for (const s of meta.stats) {
      totals.betrayals += s.betrayals;
      totals.lies += s.lies;
      totals.knockouts += s.kos;
      totals.escapes += s.escaped ? 1 : 0;
      totals.messages += s.messages;
      appearances[s.model] = (appearances[s.model] ?? 0) + 1;
    }
  }
  return { season, matchesPlayed: metas.length, currentMatch, perMatch, totals, appearances };
}
