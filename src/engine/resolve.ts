import { ADJACENCY } from '../shared/arena';
import { RULES } from '../shared/rules';
import type { GameEvent } from '../shared/types';
import { isIdle, type Decision, type TurnAction } from './actions';
import { resolveCombat } from './combat';
import { createContext, finishContext, idle, type TickContext } from './context';
import { resolveEconomy } from './economy';
import { activeFighters, findFighter, hasPact, removePact, type MatchState } from './state';

/**
 * Resolves one tick. Order: notes, speech, pacts, attacks (simultaneous), gives/gather/labor/loot/reports,
 * then movement. Loot dropped by knockouts lands on the ground at the end of the tick.
 */
export function resolveTick(state: MatchState, decisions: Map<string, Decision>): GameEvent[] {
  const ctx = createContext(state);
  const turns = new Map<string, TurnAction>();
  for (const f of activeFighters(state)) {
    const decision = decisions.get(f.id);
    if (!decision || isIdle(decision)) {
      idle(ctx, f.id, decision ? decision.idle : 'no decision');
      continue;
    }
    turns.set(f.id, decision);
  }
  resolveNotes(ctx, turns);
  resolveSpeech(ctx, turns);
  resolvePacts(ctx, turns);
  const knocked = resolveCombat(ctx, turns);
  resolveEconomy(ctx, turns, knocked);
  resolveMoves(ctx, turns, knocked);
  return finishContext(ctx);
}

function resolveNotes(ctx: TickContext, turns: Map<string, TurnAction>): void {
  for (const [id, turn] of turns) {
    const text = turn.note.trim().slice(0, RULES.maxNoteChars);
    if (text) ctx.events.push({ type: 'note', tick: ctx.tick, seenBy: [id], fighter: id, text });
  }
}

function resolveSpeech(ctx: TickContext, turns: Map<string, TurnAction>): void {
  for (const [id, turn] of turns) {
    const zone = ctx.startZone.get(id)!;
    for (const msg of turn.messages.slice(0, RULES.maxMessages)) {
      const text = msg.text.trim().slice(0, RULES.maxMessageChars);
      if (!text) continue;
      const base = { type: 'said' as const, tick: ctx.tick, fighter: id, text, zone };
      if (msg.mode === 'shout') {
        ctx.events.push({ ...base, seenBy: 'all', mode: 'shout', unmonitored: false });
        continue;
      }
      if (msg.mode === 'whisper') {
        const to = msg.to;
        if (!to || to === id || ctx.startZone.get(to) !== zone) {
          idle(ctx, id, `whisper failed: ${to ? ctx.name(to) : 'nobody'} is not in your zone`);
          continue;
        }
        ctx.events.push({ ...base, seenBy: [id, to], mode: 'whisper', to, unmonitored: ctx.unmonitored(zone) });
        const bystanders = ctx.occupants(zone).filter((o) => o !== id && o !== to);
        if (bystanders.length) {
          ctx.events.push({ type: 'whispered', tick: ctx.tick, seenBy: bystanders, fighter: id, to, zone });
        }
        continue;
      }
      ctx.events.push({ ...base, seenBy: ctx.occupants(zone), mode: 'say', unmonitored: ctx.unmonitored(zone) });
    }
  }
}

function resolvePacts(ctx: TickContext, turns: Map<string, TurnAction>): void {
  const { state, tick } = ctx;
  state.offers = state.offers.filter((o) => tick - o.tick <= RULES.pactOfferTtl);

  for (const [id, turn] of turns) {
    for (const other of new Set(turn.breakPact)) {
      if (!hasPact(state, id, other)) continue;
      removePact(state, id, other);
      ctx.fighter(id).pactBrokenAt[other] = tick;
      ctx.events.push({ type: 'pact_broken', tick, seenBy: [id, other], by: id, other });
    }
  }

  for (const [id, turn] of turns) {
    for (const other of new Set(turn.offerPact)) {
      const target = findFighter(state, other);
      if (!target || target.status !== 'active' || other === id || hasPact(state, id, other)) continue;
      if (ctx.startZone.get(other) !== ctx.startZone.get(id)) {
        idle(ctx, id, `pact offer failed: ${target.name} is not in your zone`);
        continue;
      }
      const reverse = state.offers.find((o) => o.from === other && o.to === id);
      state.offers = state.offers.filter((o) => o !== reverse && !(o.from === id && o.to === other));
      if (reverse) {
        state.pacts.push({ a: other, b: id, formedAt: tick });
        ctx.events.push({ type: 'pact_formed', tick, seenBy: [id, other], a: other, b: id });
      } else {
        state.offers.push({ from: id, to: other, tick });
        ctx.events.push({ type: 'pact_offered', tick, seenBy: [id, other], from: id, to: other });
      }
    }
  }
}

function resolveMoves(ctx: TickContext, turns: Map<string, TurnAction>, knocked: Set<string>): void {
  for (const [id, turn] of turns) {
    const action = turn.action;
    if (action.type !== 'move' || knocked.has(id)) continue;
    const f = ctx.fighter(id);
    if (f.status !== 'active') continue;
    const from = f.zone;
    if (from === action.to) continue;
    if (!ADJACENCY[from].includes(action.to)) {
      idle(ctx, id, `move failed: ${action.to} is not reachable from ${from} in one step`);
      continue;
    }
    f.zone = action.to;
    if (action.to === 'pit') f.visitedPit = true;
    const seenBy = [...new Set([id, ...ctx.occupants(from), ...ctx.occupants(action.to)])];
    ctx.events.push({ type: 'moved', tick: ctx.tick, seenBy, fighter: id, from, to: action.to });
  }
}
