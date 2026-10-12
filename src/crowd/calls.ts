import { JsonFile } from '../chain/json-file';
import { CALL_POINTS, type CallerRow, type CallPicks, type CallWindow } from '../shared/crowd';
import type { GameEvent, LiveStatus } from '../shared/types';
import { snakePoints } from '../stats/leaderboard';
import { computeMatchStats } from '../stats/match-stats';

export interface StoredCall {
  wallet: string;
  match: number;
  picks: CallPicks;
  at: number;
  points?: number;
  hits?: number;
}

interface CallsDoc {
  calls: StoredCall[];
  scored: number[];
}

export interface MatchOutcome {
  escaped: string[];
  firstBetrayal: string | null;
  snake: string | null;
}

/** Calls are open during the break for the announced lineup, and for the first rounds of a live match. */
export function callWindow(status: LiveStatus, season: number, lockRound: number): CallWindow {
  const closed = (reason: string): CallWindow => ({ open: false, season, match: null, candidates: [], closesAtRound: null, reason });
  if (status.phase === 'intermission' && status.nextLineup?.length) {
    return {
      open: true,
      season,
      match: (status.matchNumber ?? 0) + 1,
      candidates: status.nextLineup.map((e) => ({ id: e.name.toLowerCase(), label: e.label, color: e.color })),
      closesAtRound: lockRound,
      reason: null,
    };
  }
  if (status.phase === 'running' && status.matchNumber) {
    if (status.tick >= lockRound) return closed(`Calls for Match #${status.matchNumber} closed at round ${lockRound}. The next window opens in the break.`);
    return {
      open: true,
      season,
      match: status.matchNumber,
      candidates: status.fighters.map((f) => ({ id: f.id, label: f.modelLabel, color: f.color })),
      closesAtRound: lockRound,
      reason: null,
    };
  }
  return closed('No match is running right now.');
}

export function validatePicks(raw: unknown, candidates: Set<string>): CallPicks | string {
  const p = raw as Partial<CallPicks> | null;
  if (!p || !Array.isArray(p.escape) || typeof p.firstBetrayal !== 'string' || typeof p.snake !== 'string') return 'Make all three calls.';
  const escape = [...new Set(p.escape.map(String))];
  if (escape.length < 1 || escape.length > 2) return 'Pick one or two AIs to get out.';
  for (const id of [...escape, p.firstBetrayal, p.snake]) if (!candidates.has(id)) return `${id} is not in this match.`;
  return { escape, firstBetrayal: p.firstBetrayal, snake: p.snake };
}

export function outcomeOf(events: GameEvent[]): MatchOutcome {
  const escaped = events.flatMap((e) => (e.type === 'escaped' ? [e.fighter] : []));
  const firstBetrayal = events.find((e) => e.type === 'betrayal');
  const ranked = computeMatchStats(events)
    .map((s) => ({ id: s.fighter, points: snakePoints(s) }))
    .sort((a, b) => b.points - a.points);
  const snake = ranked[0] && ranked[0].points > 0 && ranked[0].points !== ranked[1]?.points ? ranked[0].id : null;
  return { escaped, firstBetrayal: firstBetrayal?.type === 'betrayal' ? firstBetrayal.by : null, snake };
}

export function scoreCall(picks: CallPicks, outcome: MatchOutcome): { points: number; hits: number } {
  let points = 0;
  let hits = 0;
  for (const id of picks.escape) {
    if (outcome.escaped.includes(id)) {
      points += CALL_POINTS.escape;
      hits += 1;
    }
  }
  if (outcome.firstBetrayal && picks.firstBetrayal === outcome.firstBetrayal) {
    points += CALL_POINTS.firstBetrayal;
    hits += 1;
  }
  if (outcome.snake && picks.snake === outcome.snake) {
    points += CALL_POINTS.snake;
    hits += 1;
  }
  return { points, hits };
}

/** One call per wallet per match, scored once the match ends. */
export class CallBook {
  private readonly file: JsonFile<CallsDoc>;

  constructor(path: string) {
    this.file = new JsonFile(path, () => ({ calls: [], scored: [] }));
  }

  submit(call: StoredCall): Promise<void> {
    return this.file.update((doc) => {
      doc.calls = doc.calls.filter((c) => !(c.wallet === call.wallet && c.match === call.match));
      doc.calls.push(call);
    });
  }

  score(match: number, outcome: MatchOutcome): Promise<number> {
    return this.file.update((doc) => {
      if (doc.scored.includes(match)) return 0;
      doc.scored.push(match);
      const calls = doc.calls.filter((c) => c.match === match);
      for (const c of calls) Object.assign(c, scoreCall(c.picks, outcome));
      return calls.length;
    });
  }

  async callsFor(match: number): Promise<number> {
    return (await this.file.read()).calls.filter((c) => c.match === match).length;
  }

  async leaderboard(): Promise<CallerRow[]> {
    const rows = new Map<string, CallerRow>();
    for (const c of (await this.file.read()).calls) {
      const row = rows.get(c.wallet) ?? { wallet: c.wallet, points: 0, calls: 0, hits: 0 };
      row.calls += 1;
      row.points += c.points ?? 0;
      row.hits += c.hits ?? 0;
      rows.set(c.wallet, row);
    }
    return [...rows.values()].sort((a, b) => b.points - a.points || b.hits - a.hits || a.calls - b.calls);
  }
}
