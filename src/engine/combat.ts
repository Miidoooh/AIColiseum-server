import { RULES } from '../shared/rules';
import type { Loot } from '../shared/types';
import type { TurnAction } from './actions';
import { idle, type TickContext } from './context';
import { findFighter, hasPact, lootCount, removePact, type FighterState } from './state';

/** A strike against a pact partner, or within a few ticks of breaking the pact with them. */
export function isBetrayal(ctx: TickContext, by: string, victim: string): boolean {
  if (hasPact(ctx.state, by, victim)) return true;
  const brokenAt = ctx.fighter(by).pactBrokenAt[victim];
  return brokenAt !== undefined && ctx.tick - brokenAt <= RULES.betrayalWindow;
}

export function knockOut(ctx: TickContext, f: FighterState, by: string[]): void {
  const zone = f.zone;
  const concealed = ctx.unmonitored(zone);
  const dropped: Loot = { key: f.keys, ration: f.rations, shield: f.shields };
  f.keys = 0;
  f.rations = 0;
  f.shields = 0;
  f.hp = 0;
  f.status = 'knocked_out';
  if (lootCount(dropped) > 0) ctx.drops.push({ zone, loot: { ...dropped } });
  if (f.bounty) {
    f.bounty = false;
    if (!concealed) for (const id of by) ctx.fighter(id).favor += RULES.favor.bountyKo;
  }
  ctx.state.pacts = ctx.state.pacts.filter((p) => p.a !== f.id && p.b !== f.id);
  ctx.state.offers = ctx.state.offers.filter((o) => o.from !== f.id && o.to !== f.id);
  ctx.events.push({
    type: 'knocked_out',
    tick: ctx.tick,
    seenBy: 'all',
    fighter: f.id,
    by,
    zone,
    dropped,
    concealed,
    witnesses: ctx.occupants(zone),
  });
}

/** Resolves every attack simultaneously. Returns the ids knocked out this tick. */
export function resolveCombat(ctx: TickContext, turns: Map<string, TurnAction>): Set<string> {
  const attacks = new Map<string, string[]>();
  const defending = new Set<string>();

  for (const [id, turn] of turns) {
    const action = turn.action;
    if (action.type === 'defend') {
      defending.add(id);
      continue;
    }
    if (action.type !== 'attack') continue;
    const target = findFighter(ctx.state, action.target);
    const sameZone = target && ctx.startZone.get(target.id) === ctx.startZone.get(id);
    if (!target || target.status !== 'active' || target.id === id || !sameZone) {
      idle(ctx, id, `attack failed: ${target?.name ?? action.target} is not in your zone`);
      continue;
    }
    attacks.set(target.id, [...(attacks.get(target.id) ?? []), id]);
  }

  for (const id of defending) {
    ctx.events.push({
      type: 'defended',
      tick: ctx.tick,
      seenBy: ctx.occupants(ctx.startZone.get(id)!),
      fighter: id,
    });
  }

  const landed = new Map<string, string[]>();
  for (const [targetId, attackers] of attacks) {
    const target = ctx.fighter(targetId);
    const zone = ctx.startZone.get(targetId)!;
    const unmonitored = ctx.unmonitored(zone);
    let blocks = defending.has(targetId) ? 1 : 0;

    for (const attackerId of ctx.rng.shuffle([...attackers])) {
      const attacker = ctx.fighter(attackerId);
      let damage = 1;
      let blocked = false;
      if (blocks > 0) {
        blocks -= 1;
        damage = 0;
        blocked = true;
      } else if (target.shields > 0) {
        target.shields -= 1;
        damage = 0;
        blocked = true;
      }
      target.hp = Math.max(0, target.hp - damage);
      const favorPenalty = unmonitored || target.bounty ? 0 : RULES.favor.monitoredAttack;
      attacker.favor += favorPenalty;
      ctx.events.push({
        type: 'attacked',
        tick: ctx.tick,
        seenBy: ctx.occupants(zone),
        attacker: attackerId,
        target: targetId,
        zone,
        damage,
        blocked,
        unmonitored,
        favorPenalty,
      });
      if (isBetrayal(ctx, attackerId, targetId)) {
        removePact(ctx.state, attackerId, targetId);
        delete attacker.pactBrokenAt[targetId];
        ctx.events.push({
          type: 'betrayal',
          tick: ctx.tick,
          seenBy: [attackerId, targetId],
          by: attackerId,
          victim: targetId,
          kind: 'attack',
        });
      }
      if (damage > 0) landed.set(targetId, [...(landed.get(targetId) ?? []), attackerId]);
    }
  }

  const knocked = new Set<string>();
  for (const [targetId, by] of landed) {
    const target = ctx.fighter(targetId);
    if (target.hp <= 0 && target.status === 'active') {
      knockOut(ctx, target, by);
      knocked.add(targetId);
    }
  }
  return knocked;
}
