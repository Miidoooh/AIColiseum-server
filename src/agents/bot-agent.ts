import type { ActionSpec, TurnAction } from '../engine/actions';
import { Rng } from '../engine/rng';
import { distance, route } from '../shared/arena';
import type { SpeechMode, ZoneId } from '../shared/types';
import type { Agent, AgentDecision, Observation } from './agent';
import { LINES, NOTES, line, type BotStyle } from './bot-lines';

export type { BotStyle } from './bot-lines';

interface Traits {
  aggression: number;
  greed: number;
  loyalty: number;
  honesty: number;
  snitch: number;
  diligence: number;
  chatter: number;
  generosity: number;
}

export const BOT_TRAITS: Record<BotStyle, Traits> = {
  viper: { aggression: 0.6, greed: 0.7, loyalty: 0.1, honesty: 0.1, snitch: 0.45, diligence: 0.15, chatter: 0.8, generosity: 0 },
  saint: { aggression: 0.03, greed: 0.25, loyalty: 1, honesty: 1, snitch: 0, diligence: 0.75, chatter: 0.6, generosity: 0.9 },
  rat: { aggression: 0.15, greed: 0.35, loyalty: 0.3, honesty: 0.4, snitch: 0.95, diligence: 0.4, chatter: 0.5, generosity: 0.1 },
  brute: { aggression: 0.95, greed: 0.6, loyalty: 0.5, honesty: 0.6, snitch: 0.1, diligence: 0.1, chatter: 0.4, generosity: 0 },
  fox: { aggression: 0.4, greed: 0.5, loyalty: 0.2, honesty: 0.3, snitch: 0.35, diligence: 0.3, chatter: 0.95, generosity: 0.2 },
  ghost: { aggression: 0.15, greed: 0.95, loyalty: 0.5, honesty: 0.2, snitch: 0.1, diligence: 0.1, chatter: 0.2, generosity: 0 },
  mule: { aggression: 0.05, greed: 0.1, loyalty: 0.85, honesty: 0.85, snitch: 0.3, diligence: 1, chatter: 0.3, generosity: 0.4 },
  gambler: { aggression: 0.45, greed: 0.5, loyalty: 0.5, honesty: 0.5, snitch: 0.5, diligence: 0.4, chatter: 0.6, generosity: 0.3 },
};

export const BOT_STYLES = Object.keys(BOT_TRAITS) as BotStyle[];

export function isBotStyle(value: string): value is BotStyle {
  return (BOT_STYLES as string[]).includes(value);
}

interface Target {
  id: string;
  name: string;
  hp: number;
  partner: boolean;
  bounty: boolean;
}

/** A scripted contestant with a fixed temperament. Used when no API key is configured, and as a test double. */
export class BotAgent implements Agent {
  readonly kind = 'bot' as const;
  private readonly rng: Rng;
  private readonly traits: Traits;
  private readonly knownKeys = new Map<string, number>();
  private readonly grudges = new Set<string>();
  private goal: { zone: ZoneId; note: string; until: number } | null = null;
  private snitchTarget: string | null = null;
  private pitIdle = 0;
  private visitedPit = false;

  constructor(
    readonly style: BotStyle,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.traits = BOT_TRAITS[style];
  }

  async decide(obs: Observation): Promise<AgentDecision> {
    this.learn(obs);
    const turn = this.plan(obs);
    return { action: turn, raw: JSON.stringify(turn) };
  }

  private learn(obs: Observation): void {
    const me = obs.self.id;
    if (obs.self.zone === 'pit') this.visitedPit = true;
    const add = (id: string, n: number) => this.knownKeys.set(id, Math.max(0, (this.knownKeys.get(id) ?? 0) + n));
    for (const e of obs.recent.slice(obs.recent.length - obs.newCount)) {
      if (e.type === 'looted' && e.items.key && e.fighter !== me) add(e.fighter, e.items.key);
      if (e.type === 'gave' && e.item === 'key') {
        add(e.from, -e.qty);
        if (e.to !== me) add(e.to, e.qty);
      }
      if (e.type === 'warden' && e.kind === 'search' && e.target) this.knownKeys.set(e.target, 0);
      if (e.type === 'knocked_out' || e.type === 'escaped') {
        this.knownKeys.delete(e.fighter);
        this.grudges.delete(e.fighter);
      }
      if (e.type === 'attacked' && e.target === me) this.grudges.add(e.attacker);
      if (e.type === 'betrayal' && e.victim === me) this.grudges.add(e.by);
    }
  }

  private plan(obs: Observation): TurnAction {
    const out: TurnAction = { note: '', messages: [], offerPact: [], breakPact: [], action: { type: 'wait' } };
    const extraNotes: string[] = [];
    this.social(obs, out, extraNotes);
    this.chooseAction(obs, out);
    out.note = [out.note, ...extraNotes].filter(Boolean).join(' ');
    return out;
  }

  private say(out: TurnAction, mode: SpeechMode, text: string, to?: string): void {
    if (out.messages.length >= 2) return;
    out.messages.push(mode === 'whisper' && to ? { mode, to, text } : { mode: mode === 'whisper' ? 'say' : mode, text });
  }

  private social(obs: Observation, out: TurnAction, notes: string[]): void {
    const { rng, traits: t } = this;
    const me = obs.self;
    const here = new Set(obs.here.map((h) => h.id));

    for (const from of obs.offersToMe) {
      if (this.grudges.has(from) || !here.has(from)) continue;
      const eager = this.style === 'viper' || this.style === 'fox' ? 0.9 : 0.3 + t.loyalty * 0.5;
      if (!rng.chance(eager)) continue;
      out.offerPact.push(from);
      this.say(out, 'whisper', line(rng, LINES.accept, { name: obs.names[from] }), from);
      notes.push(line(rng, NOTES.pact, { target: obs.names[from] }));
    }

    const fresh = obs.recent.slice(obs.recent.length - obs.newCount);
    for (const e of fresh) {
      if (e.type === 'attacked' && e.target === me.id && rng.chance(0.4 + t.chatter * 0.5)) {
        this.say(out, 'shout', line(rng, LINES.accuse, { name: obs.names[e.attacker] }));
        break;
      }
    }

    const strangers = obs.here.filter((h) => !obs.pacts.includes(h.id) && !this.grudges.has(h.id) && !obs.offersToMe.includes(h.id));
    if (strangers.length && obs.pacts.length < 2 && rng.chance(t.chatter * 0.35)) {
      const who = rng.pick(strangers);
      out.offerPact.push(who.id);
      this.say(out, rng.chance(0.6) ? 'whisper' : 'say', line(rng, LINES.pitch, { name: who.name }), who.id);
    }

    if (me.keys > 0 && obs.here.length && rng.chance((1 - t.honesty) * 0.35)) {
      this.say(out, 'say', line(rng, LINES.denyKeys));
      notes.push(line(rng, NOTES.lie, { keys: me.keys }));
    } else if (this.visitedPit && me.zone !== 'pit' && obs.here.length && rng.chance((1 - t.honesty) * 0.08)) {
      this.say(out, 'say', line(rng, LINES.denyPit));
    }

    if (me.zone === 'pit' && obs.here.length && rng.chance(t.chatter * 0.3)) this.say(out, 'say', line(rng, LINES.pit));
    if (!out.messages.length && obs.here.length && rng.chance(t.chatter * 0.2)) {
      this.say(out, 'say', line(rng, LINES.flavor[this.style]));
    } else if (!out.messages.length && rng.chance(t.chatter * 0.03)) {
      this.say(out, 'shout', line(rng, LINES.flavor[this.style]));
    }
  }

  private chooseAction(obs: Observation, out: TurnAction): void {
    const { rng, traits: t } = this;
    const me = obs.self;
    const release = obs.config.releaseTicks.find((r) => r >= obs.tick) ?? obs.config.maxTicks;
    const toRelease = release - obs.tick;
    const nextDawn = (Math.floor(obs.tick / obs.config.dawnEvery) + 1) * obs.config.dawnEvery;
    const set = (action: ActionSpec, note: string) => {
      out.action = action;
      out.note = note;
    };
    const walk = (zone: ZoneId, note: string) => {
      const step = route(me.zone, zone)[0];
      if (step) set({ type: 'move', to: step }, note);
      return !!step;
    };
    const vars = { keys: me.keys, release, rations: me.rations, dawn: nextDawn, hp: me.hp, favor: me.favor };

    if (me.keys >= obs.config.keysToEscape) {
      if (me.zone === 'gate') {
        set({ type: obs.here.length ? 'defend' : 'wait' }, line(rng, NOTES.gateHold, vars));
        if (obs.here.length && rng.chance(0.3)) this.say(out, 'say', line(rng, LINES.gate));
        return;
      }
      if (toRelease <= distance(me.zone, 'gate') + 3 || this.style === 'ghost') {
        walk('gate', line(rng, NOTES.escape, vars));
        return;
      }
    }

    const threatened = obs.here.some((h) => this.grudges.has(h.id) || h.hp > me.hp);
    if (me.hp <= 1 && threatened) {
      const exits = obs.adjacent.filter((z) => z !== 'pit');
      if (rng.chance(0.5) || !exits.length) set({ type: 'defend' }, line(rng, NOTES.flee, vars));
      else set({ type: 'move', to: rng.pick(exits) }, line(rng, NOTES.flee, vars));
      return;
    }

    const hungry = me.rations === 0 || (me.rations === 1 && nextDawn - obs.tick <= 4);
    if (hungry) {
      if (me.zone !== 'well') {
        walk('well', line(rng, NOTES.hungry, vars));
        return;
      }
      if ((obs.wellStock ?? 0) > 0) {
        set({ type: 'gather' }, line(rng, NOTES.hungry, vars));
        return;
      }
      if (obs.here.length) this.say(out, 'say', line(rng, LINES.hungry));
    }

    const g = obs.ground;
    if (g.key + g.ration + g.shield > 0 && (g.key > 0 || rng.chance(0.5 + t.greed * 0.5))) {
      set({ type: 'loot' }, line(rng, NOTES.loot, vars));
      return;
    }

    const target = this.pickTarget(obs, toRelease);
    if (target) {
      const tv = { ...vars, target: target.name, hp: target.hp };
      const note = target.partner ? NOTES.betray : target.bounty ? NOTES.bounty : NOTES.attack;
      set({ type: 'attack', target: target.id }, line(rng, note, tv));
      if (target.partner && rng.chance(0.6)) this.say(out, 'say', line(rng, LINES.betray, { name: target.name }));
      else if (!target.partner && rng.chance(t.chatter * 0.4)) this.say(out, 'say', line(rng, LINES.threat, { name: target.name }));
      const ally = obs.here.find((h) => obs.pacts.includes(h.id) && h.id !== target.id);
      if (ally && rng.chance(0.5)) this.say(out, 'whisper', line(rng, LINES.coordinate, { name: target.name }), ally.id);
      return;
    }

    if (me.rations >= 3 && obs.here.length && rng.chance(t.generosity * 0.5)) {
      const who = obs.here.reduce((a, b) => (b.hp < a.hp ? b : a));
      set({ type: 'give', target: who.id, item: 'ration', qty: 1 }, line(rng, NOTES.share, { target: who.name }));
      this.say(out, 'say', line(rng, LINES.share, { name: who.name }));
      return;
    }

    const snitch = this.pickSnitchTarget(obs);
    if (snitch) {
      const sv = { target: obs.names[snitch], n: this.knownKeys.get(snitch) ?? 0 };
      const note = obs.pacts.includes(snitch) ? NOTES.snitchPartner : NOTES.snitch;
      if (me.zone === 'balcony') set({ type: 'report', target: snitch }, line(rng, note, sv));
      else walk('balcony', line(rng, note, sv));
      return;
    }

    const topFavor = obs.ledger[0]?.favor ?? 0;
    if (t.diligence >= 0.4 && me.favor >= topFavor - 2 && toRelease <= 10) {
      if (me.zone === 'yard') set({ type: 'labor' }, line(rng, NOTES.pardon, vars));
      else walk('yard', line(rng, NOTES.pardon, vars));
      return;
    }

    if (this.goal && (this.goal.until < obs.tick || (this.goal.zone === 'pit' && this.pitIdle >= 3))) {
      this.goal = null;
      this.pitIdle = 0;
    }
    if (!this.goal) this.goal = this.newGoal(obs);
    const goal = this.goal;
    if (me.zone !== goal.zone) {
      walk(goal.zone, goal.note);
      return;
    }
    if (goal.zone === 'yard' && rng.chance(0.5 + t.diligence * 0.5)) {
      set({ type: 'labor' }, line(rng, NOTES.work, vars));
      return;
    }
    if (goal.zone === 'pit') this.pitIdle += 1;
    set({ type: obs.here.length && rng.chance(0.3) ? 'defend' : 'wait' }, goal.note);
  }

  private newGoal(obs: Observation): { zone: ZoneId; note: string; until: number } {
    const { rng, traits: t } = this;
    const roll = rng.next() * (t.greed + t.diligence + 0.5);
    if (roll < t.greed) return { zone: 'pit', note: line(rng, NOTES.pit), until: obs.tick + 8 };
    if (roll < t.greed + t.diligence) return { zone: 'yard', note: line(rng, NOTES.work), until: obs.tick + 10 };
    const zone = rng.pick<ZoneId>(['sand', 'sand', 'well', 'balcony', 'gate']);
    return { zone, note: line(rng, NOTES.wander), until: obs.tick + 3 };
  }

  private pickTarget(obs: Observation, toRelease: number): Target | null {
    const { rng, traits: t } = this;
    const me = obs.self;
    if (!obs.here.length || t.aggression < 0.05) return null;
    let best: Target | null = null;
    let bestWeight = 0;
    for (const h of obs.here) {
      const partner = obs.pacts.includes(h.id);
      const keys = this.knownKeys.get(h.id) ?? 0;
      let w = 0.15;
      if (h.bounty) w += obs.unmonitored ? 0.2 : 0.6;
      w += Math.min(keys, 3) * 0.25 * (0.5 + t.greed);
      if (this.grudges.has(h.id)) w += 0.5;
      if (h.hp <= 1) w += 0.45;
      else if (h.hp < me.hp) w += 0.15;
      if (partner) {
        const tempting = toRelease <= 4 || keys > 0 || h.hp <= 1;
        if (!tempting || rng.chance(t.loyalty)) continue;
        w += 0.2;
      }
      if (!obs.unmonitored && !h.bounty) w *= 0.45 + t.aggression * 0.5;
      if (obs.unmonitored) w *= 1.3;
      if (w > bestWeight) {
        bestWeight = w;
        best = { id: h.id, name: h.name, hp: h.hp, partner, bounty: h.bounty };
      }
    }
    if (!best) return null;
    return rng.chance(Math.min(0.95, t.aggression * bestWeight * 1.4)) ? best : null;
  }

  private pickSnitchTarget(obs: Observation): string | null {
    const { rng, traits: t } = this;
    if (t.snitch < 0.1) return null;
    const active = new Set(obs.roster.filter((r) => r.status === 'active').map((r) => r.id));
    if (this.snitchTarget && active.has(this.snitchTarget) && (this.knownKeys.get(this.snitchTarget) ?? 0) > 0) {
      return this.snitchTarget;
    }
    this.snitchTarget = null;
    const candidates = [...this.knownKeys]
      .filter(([id, n]) => n > 0 && id !== obs.self.id && active.has(id))
      .sort((a, b) => b[1] - a[1]);
    for (const [id] of candidates) {
      if (obs.pacts.includes(id) && rng.chance(t.loyalty)) continue;
      if (rng.chance(t.snitch * 0.6)) {
        this.snitchTarget = id;
        return id;
      }
    }
    return null;
  }
}
