import {
  countAppearances,
  createEntrants,
  createGladiatorEntrants,
  pickLineup,
  publicEntry,
  type AgentSettings,
  type Entrant,
  type ModelPool,
} from '../agents/roster';
import type { Rng } from '../engine/rng';
import { gladiatorModelId, type StoredGladiator } from '../crowd/gladiators';
import type { LineupEntry, MatchMeta, MatchMode } from '../shared/types';

export interface PlannedMatch {
  mode: MatchMode;
  lineup: LineupEntry[];
  build(settings: AgentSettings): Entrant[];
}

export const MAX_GLADIATORS_PER_MATCH = 4;

/**
 * Research matches seat only house AIs. Every `openEvery`-th match is an Open Arena match when gladiators
 * are waiting: the least-played gladiators take up to four seats and house AIs fill the rest.
 */
export function planMatch(opts: {
  number: number;
  pool: ModelPool;
  played: MatchMeta[];
  gladiators: StoredGladiator[];
  openEvery: number;
  rng: Rng;
}): PlannedMatch {
  const appearances = countAppearances(opts.played);
  const open = opts.gladiators.length > 0 && opts.number % opts.openEvery === 0;
  if (!open) {
    const house = pickLineup(opts.pool, appearances, opts.rng);
    return { mode: 'llm', lineup: house.map(publicEntry), build: (s) => createEntrants(house, s) };
  }
  const seated = [...opts.gladiators]
    .sort((a, b) => (appearances.get(gladiatorModelId(a.id)) ?? 0) - (appearances.get(gladiatorModelId(b.id)) ?? 0) || a.createdAt - b.createdAt)
    .slice(0, MAX_GLADIATORS_PER_MATCH);
  const house = pickLineup({ ...opts.pool, perMatch: opts.pool.perMatch - seated.length }, appearances, opts.rng);
  const lineup: LineupEntry[] = [
    ...seated.map((g) => ({ name: g.name, color: g.color, model: gladiatorModelId(g.id), label: `${g.name} · ${g.modelLabel}`, lab: 'Holder gladiator' })),
    ...house.map(publicEntry),
  ];
  return {
    mode: 'open',
    lineup,
    build: (s) => [...createGladiatorEntrants(seated, opts.pool.pool, s), ...createEntrants(house, s)],
  };
}
