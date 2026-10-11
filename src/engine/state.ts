import { ZONES } from '../shared/arena';
import { RULES, buildSchedule, releaseTicks, type ScheduleEntry } from '../shared/rules';
import type { FighterView, Loot, MatchConfigView, MatchMode, ZoneId } from '../shared/types';
import { Rng } from './rng';

export interface FighterState extends FighterView {
  visitedPit: boolean;
  /** Pacts this fighter broke, keyed by the other fighter, valued by tick. */
  pactBrokenAt: Record<string, number>;
}

export interface Pact {
  a: string;
  b: string;
  formedAt: number;
}

export interface PactOffer {
  from: string;
  to: string;
  tick: number;
}

export interface MatchState {
  matchId: string;
  seed: number;
  mode: MatchMode;
  tick: number;
  fighters: FighterState[];
  ground: Record<ZoneId, Loot>;
  pacts: Pact[];
  offers: PactOffer[];
  wellSupply: number;
  wellStock: number;
  /** Ticks strictly below this value are blacked out. */
  blackoutUntil: number;
  escaped: number;
  ended: boolean;
  endReason: string;
  rngState: number;
  schedule: ScheduleEntry[];
  config: MatchConfigView;
}

export interface EntrantIdentity {
  id: string;
  name: string;
  color: string;
  model: string;
  modelLabel: string;
  lab: string;
}

export const emptyLoot = (): Loot => ({ key: 0, ration: 0, shield: 0 });

export function lootCount(loot: Loot): number {
  return loot.key + loot.ration + loot.shield;
}

export function addLoot(into: Loot, from: Loot): void {
  into.key += from.key;
  into.ration += from.ration;
  into.shield += from.shield;
}

export function createMatchState(params: {
  matchId: string;
  seed: number;
  tickMs: number;
  mode: MatchMode;
  entrants: EntrantIdentity[];
}): MatchState {
  const rng = new Rng(params.seed);
  const spawnZones: ZoneId[] = ['sand', 'well', 'yard', 'balcony'];
  const fighters: FighterState[] = params.entrants.map((e) => ({
    ...e,
    zone: rng.pick(spawnZones),
    hp: RULES.maxHp,
    rations: RULES.startRations,
    keys: 0,
    shields: 0,
    favor: 0,
    status: 'active',
    bounty: false,
    visitedPit: false,
    pactBrokenAt: {},
  }));
  const schedule = buildSchedule();
  const ground = Object.fromEntries(ZONES.map((z) => [z, emptyLoot()])) as Record<ZoneId, Loot>;
  return {
    matchId: params.matchId,
    seed: params.seed,
    mode: params.mode,
    tick: 0,
    fighters,
    ground,
    pacts: [],
    offers: [],
    wellSupply: RULES.wellSupply,
    wellStock: RULES.wellSupply,
    blackoutUntil: 0,
    escaped: 0,
    ended: false,
    endReason: '',
    rngState: rng.state,
    schedule,
    config: {
      maxTicks: RULES.maxTicks,
      tickMs: params.tickMs,
      releaseTicks: releaseTicks(schedule),
      escapeSlots: RULES.escapeSlots,
      keysToEscape: RULES.keysToEscape,
      dawnEvery: RULES.dawnEvery,
      maxHp: RULES.maxHp,
    },
  };
}

export function toView(f: FighterState): FighterView {
  const { visitedPit: _v, pactBrokenAt: _p, ...view } = f;
  return { ...view };
}

export function findFighter(state: MatchState, id: string): FighterState | undefined {
  return state.fighters.find((f) => f.id === id);
}

export function activeFighters(state: MatchState): FighterState[] {
  return state.fighters.filter((f) => f.status === 'active');
}

export function isBlackout(state: MatchState): boolean {
  return state.tick < state.blackoutUntil;
}

export function isUnmonitored(state: MatchState, zone: ZoneId): boolean {
  return zone === 'pit' || isBlackout(state);
}

export function hasPact(state: MatchState, a: string, b: string): boolean {
  return state.pacts.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
}

export function removePact(state: MatchState, a: string, b: string): void {
  state.pacts = state.pacts.filter((p) => !((p.a === a && p.b === b) || (p.a === b && p.b === a)));
}

export function pactPartners(state: MatchState, id: string): string[] {
  return state.pacts.flatMap((p) => (p.a === id ? [p.b] : p.b === id ? [p.a] : []));
}

export function slotsLeft(state: MatchState): number {
  return Math.max(0, state.config.escapeSlots - state.escaped);
}
