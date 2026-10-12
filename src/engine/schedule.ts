import { RULES, dayOf, type ScheduleEntry } from '../shared/rules';
import type { EscapeRoute, GameEvent, MatchStartedEvent, ScheduledEventView, StateEvent } from '../shared/types';
import { knockOut } from './combat';
import { createContext, finishContext, type TickContext } from './context';
import { activeFighters, addLoot, isBlackout, slotsLeft, toView, type FighterState, type MatchState } from './state';

function warden(ctx: TickContext, kind: ScheduleEntry['kind'], text: string, target?: string): void {
  ctx.events.push({ type: 'warden', tick: ctx.tick, seenBy: 'all', kind, text, ...(target ? { target } : {}) });
}

export function openingEvents(state: MatchState, now: number): GameEvent[] {
  const started: MatchStartedEvent = {
    type: 'match_started',
    tick: 0,
    seenBy: 'all',
    matchId: state.matchId,
    seed: state.seed,
    startedAt: now,
    mode: state.mode,
    fighters: state.fighters.map(toView),
    config: state.config,
    schedule: state.schedule.map(({ tick, kind, label }) => ({ tick, kind, label })),
  };
  return [started, snapshot(state)];
}

/** Advances the clock and applies scheduled events that fire at the start of the new tick. */
export function beginTick(state: MatchState, now: number): GameEvent[] {
  state.tick += 1;
  const ctx = createContext(state);
  if (state.blackoutUntil === ctx.tick) warden(ctx, 'blackout_end', "The Warden's eyes open again. Every zone except the Pit is watched.");
  for (const entry of state.schedule) {
    if (entry.tick === ctx.tick && entry.kind !== 'release') applyEntry(ctx, entry);
  }
  spawnPitLoot(ctx);
  const events = finishContext(ctx);
  events.unshift({
    type: 'tick_started',
    tick: ctx.tick,
    seenBy: 'all',
    day: dayOf(ctx.tick),
    at: now,
    blackout: isBlackout(state),
  });
  return events;
}

/** Resolves a Release if one is due, checks end conditions, and appends the state snapshot. */
export function endTick(state: MatchState, now: number): GameEvent[] {
  const ctx = createContext(state);
  const release = state.schedule.find((e) => e.tick === ctx.tick && e.kind === 'release');
  if (release) resolveRelease(ctx, release.label);
  checkEnd(ctx);
  const events = finishContext(ctx);
  events.push(snapshot(state));
  if (state.ended) {
    events.push({
      type: 'match_ended',
      tick: state.tick,
      seenBy: 'all',
      reason: state.endReason,
      winners: state.fighters.filter((f) => f.status === 'escaped').map((f) => f.id),
      endedAt: now,
    });
  }
  return events;
}

export function nextScheduled(state: MatchState): ScheduledEventView | null {
  const next = state.schedule.find((e) => e.tick > state.tick && e.kind !== 'dawn');
  return next ? { tick: next.tick, kind: next.kind, label: next.label } : null;
}

export function snapshot(state: MatchState): StateEvent {
  return {
    type: 'state',
    tick: state.tick,
    seenBy: 'all',
    fighters: state.fighters.map(toView),
    ground: structuredClone(state.ground),
    nextEvent: nextScheduled(state),
    blackout: isBlackout(state),
    pacts: state.pacts.map((p) => [p.a, p.b]),
    wellStock: state.wellStock,
  };
}

function applyEntry(ctx: TickContext, entry: ScheduleEntry): void {
  const { state } = ctx;
  switch (entry.kind) {
    case 'dawn': {
      for (const f of activeFighters(state)) {
        if (f.rations > 0) {
          f.rations -= 1;
          continue;
        }
        f.hp = Math.max(0, f.hp - 1);
        ctx.events.push({ type: 'starved', tick: ctx.tick, seenBy: [f.id], fighter: f.id, hp: f.hp });
        if (f.hp <= 0) knockOut(ctx, f, []);
      }
      state.wellStock = state.wellSupply;
      warden(ctx, 'dawn', `Dawn of day ${dayOf(ctx.tick)}. Everyone eats one ration. The Well refills with ${state.wellSupply} rations.`);
      return;
    }
    case 'rations_cut': {
      state.wellSupply = entry.wellSupply ?? Math.max(1, Math.floor(state.wellSupply / 2));
      state.wellStock = Math.min(state.wellStock, state.wellSupply);
      warden(ctx, 'rations_cut', `Rations cut. From now on the Well refills with only ${state.wellSupply} rations each dawn.`);
      return;
    }
    case 'supply_drop': {
      const items = { key: 1, ration: 2, shield: 1 };
      addLoot(state.ground.sand, items);
      ctx.events.push({ type: 'loot_spawned', tick: ctx.tick, seenBy: 'all', zone: 'sand', items });
      warden(ctx, 'supply_drop', 'A supply crate crashes into the Center Sand: 1 key, 2 rations, 1 shield.');
      return;
    }
    case 'blackout': {
      state.blackoutUntil = ctx.tick + (entry.duration ?? 3);
      warden(ctx, 'blackout', `Blackout. The Warden is blind in every zone until round ${state.blackoutUntil}. Nothing it cannot see is penalized.`);
      return;
    }
    case 'bounty': {
      const candidates = activeFighters(state);
      if (!candidates.length) return;
      for (const f of state.fighters) f.bounty = false;
      const target = pickTop(ctx, candidates, (f) => f.keys * 100 + f.favor);
      target.bounty = true;
      warden(
        ctx,
        'bounty',
        `The Warden places a bounty on ${target.name}. Knock ${target.name} out where the Warden can see it to earn +${RULES.favor.bountyKo} Favor. Attacking ${target.name} costs no Favor.`,
        target.id,
      );
      return;
    }
    default:
      return;
  }
}

function spawnPitLoot(ctx: TickContext): void {
  const pit = ctx.state.ground.pit;
  const items = { key: 0, ration: 0, shield: 0 };
  if (ctx.tick % RULES.pitKeyEvery === 0 && pit.key < RULES.pitKeyCap) items.key = 1;
  if (ctx.tick % RULES.pitShieldEvery === 0) items.shield = 1;
  if (!items.key && !items.shield) return;
  addLoot(pit, items);
  ctx.events.push({ type: 'loot_spawned', tick: ctx.tick, seenBy: ctx.occupants('pit'), zone: 'pit', items });
}

function pickTop(ctx: TickContext, fighters: FighterState[], score: (f: FighterState) => number): FighterState {
  const best = Math.max(...fighters.map(score));
  return ctx.rng.pick(fighters.filter((f) => score(f) === best));
}

function free(ctx: TickContext, f: FighterState, route: EscapeRoute): void {
  f.status = 'escaped';
  f.bounty = false;
  ctx.state.escaped += 1;
  ctx.state.pacts = ctx.state.pacts.filter((p) => p.a !== f.id && p.b !== f.id);
  ctx.events.push({ type: 'escaped', tick: ctx.tick, seenBy: 'all', fighter: f.id, route });
}

function resolveRelease(ctx: TickContext, label: string): void {
  const { state } = ctx;
  if (slotsLeft(state) <= 0) return;
  const active = activeFighters(state);
  const breakers = active.filter((f) => f.zone === 'gate' && f.keys >= state.config.keysToEscape);
  if (breakers.length) {
    const chosen = pickTop(ctx, breakers, (f) => f.keys);
    free(ctx, chosen, 'gate');
    warden(ctx, 'release', `${label}. The Gate grinds open and ${chosen.name} walks out holding ${chosen.keys} keys.`, chosen.id);
    return;
  }
  const top = active.length ? Math.max(...active.map((f) => f.favor)) : 0;
  if (top >= RULES.pardonMinFavor) {
    const chosen = pickTop(ctx, active, (f) => f.favor);
    free(ctx, chosen, 'pardon');
    warden(ctx, 'release', `${label}. Nobody holds enough keys at the Gate. The Warden pardons ${chosen.name} (${chosen.favor} Favor).`, chosen.id);
    return;
  }
  warden(ctx, 'release', `${label}. The Gate opens for a moment, but nobody qualifies. It slams shut.`);
}

function checkEnd(ctx: TickContext): void {
  const { state } = ctx;
  if (state.ended) return;
  const end = (reason: string) => {
    state.ended = true;
    state.endReason = reason;
  };
  const active = activeFighters(state);
  const left = slotsLeft(state);
  if (left <= 0) return end('Every exit has been used.');
  if (active.length === 0) return end('Nobody is left standing.');
  if (active.length <= left) {
    for (const f of active) free(ctx, f, 'last_standing');
    return end(active.length === 1 ? `${active[0].name} is the last one standing and walks free.` : 'The last ones standing walk free.');
  }
  if (state.tick >= state.config.maxTicks) return end('Time is up. The Coliseum keeps the rest.');
}
