import type { GameEvent, Loot, ZoneId } from '../shared/types';
import { Rng } from './rng';
import { activeFighters, addLoot, findFighter, isUnmonitored, type FighterState, type MatchState } from './state';

/** Working state for one resolution step. Zones are frozen at the start so actions resolve simultaneously. */
export interface TickContext {
  state: MatchState;
  tick: number;
  rng: Rng;
  events: GameEvent[];
  startZone: Map<string, ZoneId>;
  drops: { zone: ZoneId; loot: Loot }[];
  occupants(zone: ZoneId): string[];
  unmonitored(zone: ZoneId): boolean;
  fighter(id: string): FighterState;
  name(id: string): string;
}

export function createContext(state: MatchState): TickContext {
  const startZone = new Map(activeFighters(state).map((f) => [f.id, f.zone] as const));
  return {
    state,
    tick: state.tick,
    rng: new Rng(state.rngState),
    events: [],
    startZone,
    drops: [],
    occupants: (zone) => [...startZone].filter(([, z]) => z === zone).map(([id]) => id),
    unmonitored: (zone) => isUnmonitored(state, zone),
    fighter: (id) => {
      const f = findFighter(state, id);
      if (!f) throw new Error(`Unknown fighter ${id}`);
      return f;
    },
    name: (id) => findFighter(state, id)?.name ?? id,
  };
}

export function finishContext(ctx: TickContext): GameEvent[] {
  for (const drop of ctx.drops) addLoot(ctx.state.ground[drop.zone], drop.loot);
  ctx.drops = [];
  ctx.state.rngState = ctx.rng.state;
  return ctx.events;
}

export function idle(ctx: TickContext, fighter: string, reason: string): void {
  ctx.events.push({ type: 'idle', tick: ctx.tick, seenBy: [fighter], fighter, reason });
}
