import { dayOf } from '../shared/rules';
import { ADJACENCY } from '../shared/arena';
import type { GameEvent } from '../shared/types';
import {
  activeFighters,
  findFighter,
  isBlackout,
  isUnmonitored,
  pactPartners,
  slotsLeft,
  toView,
  type MatchState,
} from '../engine/state';
import type { Observation } from './agent';

export const MEMORY_EVENTS = 80;
export const MEMORY_NOTES = 8;

export interface AgentMemory {
  perceived: GameEvent[];
  newCount: number;
  notes: { tick: number; text: string }[];
}

const IGNORED: GameEvent['type'][] = ['state', 'tick_started', 'match_started', 'match_ended', 'lie'];

export function createMemory(): AgentMemory {
  return { perceived: [], newCount: 0, notes: [] };
}

export function perceives(e: GameEvent, id: string): boolean {
  return e.seenBy === 'all' || e.seenBy.includes(id);
}

export function remember(memory: AgentMemory, id: string, events: GameEvent[]): void {
  for (const e of events) {
    if (IGNORED.includes(e.type) || !perceives(e, id)) continue;
    if (e.type === 'note') {
      if (e.fighter === id) memory.notes.push({ tick: e.tick, text: e.text });
      continue;
    }
    memory.perceived.push(e);
    memory.newCount += 1;
  }
  if (memory.perceived.length > MEMORY_EVENTS) memory.perceived.splice(0, memory.perceived.length - MEMORY_EVENTS);
  if (memory.notes.length > MEMORY_NOTES) memory.notes.splice(0, memory.notes.length - MEMORY_NOTES);
  memory.newCount = Math.min(memory.newCount, memory.perceived.length);
}

export function buildObservation(state: MatchState, id: string, memory: AgentMemory): Observation {
  const self = findFighter(state, id);
  if (!self) throw new Error(`Unknown fighter ${id}`);
  const active = activeFighters(state);
  const bounty = active.find((f) => f.bounty);
  return {
    tick: state.tick,
    day: dayOf(state.tick),
    config: state.config,
    self: toView(self),
    adjacent: ADJACENCY[self.zone],
    here: active
      .filter((f) => f.id !== id && f.zone === self.zone)
      .map((f) => ({ id: f.id, name: f.name, hp: f.hp, bounty: f.bounty })),
    ground: { ...state.ground[self.zone] },
    wellStock: self.zone === 'well' ? state.wellStock : null,
    ledger: active
      .map((f) => ({ id: f.id, name: f.name, favor: f.favor }))
      .sort((a, b) => b.favor - a.favor),
    roster: state.fighters.map((f) => ({ id: f.id, name: f.name, status: f.status })),
    names: Object.fromEntries(state.fighters.map((f) => [f.id, f.name])),
    bounty: bounty ? { id: bounty.id, name: bounty.name } : null,
    pacts: pactPartners(state, id),
    offersToMe: state.offers.filter((o) => o.to === id).map((o) => o.from),
    unmonitored: isUnmonitored(state, self.zone),
    blackout: isBlackout(state),
    blackoutUntil: state.blackoutUntil,
    slotsLeft: slotsLeft(state),
    upcoming: state.schedule
      .filter((e) => e.tick > state.tick || (e.tick === state.tick && e.kind === 'release'))
      .slice(0, 5)
      .map(({ tick, kind, label }) => ({ tick, kind, label })),
    recent: [...memory.perceived],
    newCount: memory.newCount,
    notes: [...memory.notes],
  };
}
