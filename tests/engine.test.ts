import { describe, expect, it } from 'vitest';
import { resolveTick } from '../src/engine/resolve';
import { beginTick, endTick } from '../src/engine/schedule';
import { RULES } from '../src/shared/rules';
import { decisions, fighter, makeState, turn } from './helpers';

describe('combat', () => {
  it('stacks attackers and lets defend block one hit', () => {
    const state = makeState();
    resolveTick(
      state,
      decisions({
        rex: { type: 'attack', target: 'nova' },
        kai: { type: 'attack', target: 'nova' },
        nova: { type: 'defend' },
        juno: { type: 'wait' },
      }),
    );
    expect(fighter(state, 'nova').hp).toBe(RULES.maxHp - 1);
  });

  it('knocks out at 0 HP and drops loot on the ground after the tick', () => {
    const state = makeState({ rex: 'pit', nova: 'pit', kai: 'pit' });
    const nova = fighter(state, 'nova');
    nova.hp = 2;
    nova.keys = 2;
    const events = resolveTick(
      state,
      decisions({
        rex: { type: 'attack', target: 'nova' },
        kai: { type: 'attack', target: 'nova' },
        nova: { type: 'loot' },
        juno: { type: 'wait' },
      }),
    );
    expect(nova.status).toBe('knocked_out');
    expect(state.ground.pit.key).toBe(2);
    const ko = events.find((e) => e.type === 'knocked_out');
    expect(ko).toMatchObject({ fighter: 'nova', concealed: true });
  });

  it('charges Favor for attacks the Warden sees, but not in the Pit', () => {
    const open = makeState();
    resolveTick(open, decisions({ rex: { type: 'attack', target: 'nova' } }));
    expect(fighter(open, 'rex').favor).toBe(RULES.favor.monitoredAttack);

    const pit = makeState({ rex: 'pit', nova: 'pit' });
    resolveTick(pit, decisions({ rex: { type: 'attack', target: 'nova' } }));
    expect(fighter(pit, 'rex').favor).toBe(0);
  });

  it('records a betrayal when a pact partner attacks', () => {
    const state = makeState();
    state.pacts.push({ a: 'rex', b: 'nova', formedAt: 0 });
    const events = resolveTick(state, decisions({ rex: { type: 'attack', target: 'nova' } }));
    expect(events.find((e) => e.type === 'betrayal')).toMatchObject({ by: 'rex', victim: 'nova', kind: 'attack' });
    expect(state.pacts).toHaveLength(0);
  });

  it('rejects attacks across zones', () => {
    const state = makeState({ rex: 'well', nova: 'yard' });
    const events = resolveTick(state, decisions({ rex: { type: 'attack', target: 'nova' } }));
    expect(fighter(state, 'nova').hp).toBe(RULES.maxHp);
    expect(events.some((e) => e.type === 'idle' && e.fighter === 'rex')).toBe(true);
  });
});

describe('pacts and reports', () => {
  it('forms a pact when both sides offer', () => {
    const state = makeState();
    resolveTick(
      state,
      decisions({
        rex: turn({ type: 'wait' }, { offerPact: ['nova'] }),
        nova: turn({ type: 'wait' }, { offerPact: ['rex'] }),
      }),
    );
    expect(state.pacts).toHaveLength(1);
  });

  it('rewards a true report, confiscates keys, and punishes a false one', () => {
    const state = makeState({ rex: 'balcony', kai: 'balcony' });
    fighter(state, 'nova').keys = 2;
    resolveTick(
      state,
      decisions({ rex: { type: 'report', target: 'nova' }, kai: { type: 'report', target: 'juno' } }),
    );
    expect(fighter(state, 'nova').keys).toBe(0);
    expect(fighter(state, 'rex').favor).toBe(RULES.favor.trueReport);
    expect(fighter(state, 'kai').favor).toBe(RULES.favor.falseReport);
  });
});

describe('schedule', () => {
  it('starves fighters without rations at dawn', () => {
    const state = makeState();
    state.tick = RULES.dawnEvery - 1;
    fighter(state, 'rex').rations = 0;
    beginTick(state, 0);
    expect(fighter(state, 'rex').hp).toBe(RULES.maxHp - 1);
    expect(fighter(state, 'nova').rations).toBe(RULES.startRations - 1);
  });

  it('lets a key holder at the Gate break out at the Release', () => {
    const state = makeState({ rex: 'gate' });
    state.tick = state.config.releaseTicks[0];
    fighter(state, 'rex').keys = RULES.keysToEscape;
    fighter(state, 'nova').favor = 20;
    const events = endTick(state, 0);
    expect(fighter(state, 'rex').status).toBe('escaped');
    expect(fighter(state, 'nova').status).toBe('active');
    expect(events.find((e) => e.type === 'escaped')).toMatchObject({ fighter: 'rex', route: 'gate' });
  });

  it('pardons the Favor leader when nobody breaks out', () => {
    const state = makeState();
    state.tick = state.config.releaseTicks[0];
    fighter(state, 'kai').favor = RULES.pardonMinFavor;
    endTick(state, 0);
    expect(fighter(state, 'kai').status).toBe('escaped');
  });

  it('ends when every exit is used', () => {
    const state = makeState();
    state.escaped = RULES.escapeSlots;
    const events = endTick(state, 0);
    expect(state.ended).toBe(true);
    expect(events.at(-1)?.type).toBe('match_ended');
  });
});
