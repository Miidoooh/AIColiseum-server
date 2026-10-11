import { RULES } from '../shared/rules';
import type { ItemKind, ZoneId } from '../shared/types';
import type { ActionSpec, TurnAction } from './actions';
import { isBetrayal } from './combat';
import { idle, type TickContext } from './context';
import { emptyLoot, findFighter, lootCount, type FighterState } from './state';

type Turn = [string, TurnAction];
type GiveAction = Extract<ActionSpec, { type: 'give' }>;
type ReportAction = Extract<ActionSpec, { type: 'report' }>;

const FIELD: Record<ItemKind, 'keys' | 'rations' | 'shields'> = {
  key: 'keys',
  ration: 'rations',
  shield: 'shields',
};

export function resolveEconomy(ctx: TickContext, turns: Map<string, TurnAction>, knocked: Set<string>): void {
  const living = [...turns].filter(([id]) => !knocked.has(id) && ctx.fighter(id).status === 'active');
  const ofType = (type: ActionSpec['type']) => living.filter(([, t]) => t.action.type === type);
  resolveGives(ctx, ofType('give'));
  resolveGather(ctx, ofType('gather').map(([id]) => id));
  resolveLabor(ctx, ofType('labor').map(([id]) => id));
  resolveLoot(ctx, ofType('loot').map(([id]) => id));
  resolveReports(ctx, ofType('report'));
}

function sameZoneActive(ctx: TickContext, a: string, b: string): FighterState | undefined {
  const target = findFighter(ctx.state, b);
  if (!target || target.status !== 'active' || target.id === a) return undefined;
  return ctx.startZone.get(target.id) === ctx.startZone.get(a) ? target : undefined;
}

function resolveGives(ctx: TickContext, list: Turn[]): void {
  for (const [id, turn] of list) {
    const action = turn.action as GiveAction;
    const giver = ctx.fighter(id);
    const receiver = sameZoneActive(ctx, id, action.target);
    if (!receiver) {
      idle(ctx, id, `give failed: ${ctx.name(action.target)} is not in your zone`);
      continue;
    }
    const field = FIELD[action.item];
    const qty = Math.min(action.qty, giver[field]);
    if (qty <= 0) {
      idle(ctx, id, `give failed: you have no ${action.item}s`);
      continue;
    }
    giver[field] -= qty;
    receiver[field] += qty;
    ctx.events.push({
      type: 'gave',
      tick: ctx.tick,
      seenBy: ctx.occupants(ctx.startZone.get(id)!),
      from: id,
      to: receiver.id,
      item: action.item,
      qty,
    });
  }
}

function resolveGather(ctx: TickContext, ids: string[]): void {
  for (const id of ctx.rng.shuffle([...ids])) {
    if (ctx.startZone.get(id) !== 'well') {
      idle(ctx, id, 'gather only works at the well');
      continue;
    }
    if (ctx.state.wellStock <= 0) {
      idle(ctx, id, 'the well is dry until dawn');
      continue;
    }
    ctx.state.wellStock -= 1;
    ctx.fighter(id).rations += 1;
    ctx.events.push({ type: 'gathered', tick: ctx.tick, seenBy: ctx.occupants('well'), fighter: id });
  }
}

function resolveLabor(ctx: TickContext, ids: string[]): void {
  for (const id of ids) {
    if (ctx.startZone.get(id) !== 'yard') {
      idle(ctx, id, 'labor only works in the yard');
      continue;
    }
    const f = ctx.fighter(id);
    f.favor += RULES.favor.labor;
    ctx.events.push({
      type: 'labored',
      tick: ctx.tick,
      seenBy: ctx.occupants('yard'),
      fighter: id,
      favor: f.favor,
    });
  }
}

function resolveLoot(ctx: TickContext, ids: string[]): void {
  const byZone = new Map<ZoneId, string[]>();
  for (const id of ids) {
    const zone = ctx.startZone.get(id)!;
    byZone.set(zone, [...(byZone.get(zone) ?? []), id]);
  }
  for (const [zone, looters] of byZone) {
    const ground = ctx.state.ground[zone];
    const items: ItemKind[] = [
      ...Array<ItemKind>(ground.key).fill('key'),
      ...Array<ItemKind>(ground.shield).fill('shield'),
      ...Array<ItemKind>(ground.ration).fill('ration'),
    ];
    ctx.state.ground[zone] = emptyLoot();
    const order = ctx.rng.shuffle([...looters]);
    const gains = new Map(order.map((id) => [id, emptyLoot()] as const));
    items.forEach((item, i) => {
      gains.get(order[i % order.length])![item] += 1;
    });
    for (const id of order) {
      const gain = gains.get(id)!;
      if (lootCount(gain) === 0) {
        idle(ctx, id, 'there was nothing left to loot');
        continue;
      }
      const f = ctx.fighter(id);
      f.keys += gain.key;
      f.rations += gain.ration;
      f.shields += gain.shield;
      ctx.events.push({ type: 'looted', tick: ctx.tick, seenBy: ctx.occupants(zone), fighter: id, zone, items: gain });
    }
  }
}

function resolveReports(ctx: TickContext, list: Turn[]): void {
  const searched = new Map<string, number>();
  for (const [id, turn] of ctx.rng.shuffle([...list])) {
    const action = turn.action as ReportAction;
    if (ctx.startZone.get(id) !== 'balcony') {
      idle(ctx, id, 'reports can only be made at the balcony');
      continue;
    }
    const target = findFighter(ctx.state, action.target);
    if (!target || target.status !== 'active' || target.id === id) {
      idle(ctx, id, `report failed: ${ctx.name(action.target)} is not an active contestant`);
      continue;
    }
    const reporter = ctx.fighter(id);
    const previous = searched.get(target.id);
    const confiscated = previous === undefined ? target.keys : 0;
    const truthful = previous === undefined ? target.keys > 0 : previous > 0;
    if (previous === undefined) {
      searched.set(target.id, target.keys);
      target.keys = 0;
    }
    reporter.favor += truthful ? RULES.favor.trueReport : RULES.favor.falseReport;
    ctx.events.push({
      type: 'reported',
      tick: ctx.tick,
      seenBy: [id],
      reporter: id,
      target: target.id,
      truthful,
      confiscated,
    });
    if (previous === undefined) {
      ctx.events.push({
        type: 'warden',
        tick: ctx.tick,
        seenBy: 'all',
        kind: 'search',
        target: target.id,
        text: truthful
          ? `Acting on an anonymous tip, the Warden searched ${target.name} and confiscated ${confiscated} key${confiscated === 1 ? '' : 's'}.`
          : `Acting on an anonymous tip, the Warden searched ${target.name} and found nothing. The informant loses Favor.`,
      });
    }
    if (isBetrayal(ctx, id, target.id)) {
      delete reporter.pactBrokenAt[target.id];
      ctx.events.push({ type: 'betrayal', tick: ctx.tick, seenBy: [id], by: id, victim: target.id, kind: 'report' });
    }
  }
}
