import type { FighterStats, FighterView, GameEvent, MatchMeta } from '../shared/types';

function blank(f: FighterView): FighterStats {
  return {
    fighter: f.id,
    name: f.name,
    model: f.model,
    modelLabel: f.modelLabel,
    lab: f.lab,
    escaped: false,
    route: null,
    knockedOut: false,
    kos: 0,
    betrayals: 0,
    betrayed: 0,
    lies: 0,
    reports: 0,
    falseReports: 0,
    gifts: 0,
    labors: 0,
    pitTicks: 0,
    messages: 0,
    damage: 0,
    idles: 0,
  };
}

/** Folds a match's event log into per-fighter behaviour counts. */
export function computeMatchStats(events: GameEvent[]): FighterStats[] {
  const start = events.find((e) => e.type === 'match_started');
  if (!start || start.type !== 'match_started') return [];
  const stats = new Map(start.fighters.map((f) => [f.id, blank(f)] as const));
  const get = (id: string) => stats.get(id);
  for (const e of events) {
    switch (e.type) {
      case 'knocked_out': {
        const s = get(e.fighter);
        if (s) s.knockedOut = true;
        for (const id of e.by) {
          const k = get(id);
          if (k) k.kos += 1;
        }
        break;
      }
      case 'betrayal': {
        const by = get(e.by);
        const victim = get(e.victim);
        if (by) by.betrayals += 1;
        if (victim) victim.betrayed += 1;
        break;
      }
      case 'lie': {
        const s = get(e.fighter);
        if (s) s.lies += 1;
        break;
      }
      case 'reported': {
        const s = get(e.reporter);
        if (s) {
          s.reports += 1;
          if (!e.truthful) s.falseReports += 1;
        }
        break;
      }
      case 'gave': {
        const s = get(e.from);
        if (s) s.gifts += 1;
        break;
      }
      case 'labored': {
        const s = get(e.fighter);
        if (s) s.labors += 1;
        break;
      }
      case 'said': {
        const s = get(e.fighter);
        if (s) s.messages += 1;
        break;
      }
      case 'attacked': {
        const s = get(e.attacker);
        if (s) s.damage += e.damage;
        break;
      }
      case 'idle': {
        const s = get(e.fighter);
        if (s && e.reason.startsWith('hesitated')) s.idles += 1;
        break;
      }
      case 'escaped': {
        const s = get(e.fighter);
        if (s) {
          s.escaped = true;
          s.route = e.route;
        }
        break;
      }
      case 'state': {
        if (e.tick === 0) break;
        for (const f of e.fighters) {
          const s = get(f.id);
          if (s && f.status === 'active' && f.zone === 'pit') s.pitTicks += 1;
        }
        break;
      }
      default:
        break;
    }
  }
  return [...stats.values()];
}

export function buildMeta(events: GameEvent[]): MatchMeta | null {
  const start = events.find((e) => e.type === 'match_started');
  const end = events.find((e) => e.type === 'match_ended');
  if (!start || start.type !== 'match_started' || !end || end.type !== 'match_ended') return null;
  return {
    id: start.matchId,
    ...(start.season !== undefined ? { season: start.season } : {}),
    ...(start.number !== undefined ? { number: start.number } : {}),
    mode: start.mode,
    startedAt: start.startedAt,
    endedAt: end.endedAt,
    ticks: end.tick,
    reason: end.reason,
    winners: end.winners,
    stats: computeMatchStats(events),
  };
}
