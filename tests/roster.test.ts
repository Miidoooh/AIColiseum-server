import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEntrants, loadPool, parsePool, pickLineup } from '../src/agents/roster';
import { Rng } from '../src/engine/rng';

const pool = loadPool(fileURLToPath(new URL('../config/roster.json', import.meta.url)));

describe('the model pool', () => {
  it('has more models than seats, from at least as many labs as seats', () => {
    expect(pool.perMatch).toBe(8);
    expect(pool.pool.length).toBeGreaterThan(pool.perMatch);
    expect(new Set(pool.pool.map((e) => e.lab)).size).toBeGreaterThanOrEqual(pool.perMatch);
  });

  it('builds a model-driven agent for every seat', () => {
    const lineup = pickLineup(pool, new Map(), new Rng(1));
    const entrants = createEntrants(lineup, { apiKey: 'test-key', maxTokens: 4000, temperature: 0.8 });
    expect(entrants).toHaveLength(8);
    expect(entrants.every((e) => e.agent.kind === 'llm')).toBe(true);
  });

  it('rejects a pool where one name belongs to two labs', () => {
    const entry = { color: '#000000', label: 'X', reasoning: 'low' as const };
    const raw = {
      perMatch: 3,
      pool: [
        { ...entry, name: 'A', model: 'a/1', lab: 'One' },
        { ...entry, name: 'A', model: 'b/1', lab: 'Two' },
        { ...entry, name: 'C', model: 'c/1', lab: 'Three' },
      ],
    };
    expect(() => parsePool(raw)).toThrow(/two labs/);
  });
});

describe('pickLineup', () => {
  it('never seats two models from the same lab', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const lineup = pickLineup(pool, new Map(), new Rng(seed));
      expect(new Set(lineup.map((e) => e.lab)).size).toBe(lineup.length);
      expect(new Set(lineup.map((e) => e.name)).size).toBe(lineup.length);
    }
  });

  it('seats the models that have played least', () => {
    const veterans = new Map(pool.pool.slice(0, 6).map((e) => [e.model, 5] as const));
    const lineup = pickLineup(pool, veterans, new Rng(7));
    const fresh = lineup.filter((e) => !veterans.has(e.model));
    expect(fresh.length).toBeGreaterThanOrEqual(Math.min(8, new Set(pool.pool.filter((e) => !veterans.has(e.model)).map((e) => e.lab)).size));
  });

  it('gives every model a fair share over a season, within what one-seat-per-lab allows', () => {
    const counts = new Map<string, number>();
    const rng = new Rng(42);
    for (let match = 0; match < 70; match++) {
      for (const e of pickLineup(pool, counts, rng)) counts.set(e.model, (counts.get(e.model) ?? 0) + 1);
    }
    const labSize = new Map<string, number>();
    for (const e of pool.pool) labSize.set(e.lab, (labSize.get(e.lab) ?? 0) + 1);
    const values = pool.pool.map((e) => counts.get(e.model) ?? 0);
    expect(Math.min(...values)).toBeGreaterThan(0);
    expect(Math.max(...values) / Math.min(...values)).toBeLessThanOrEqual(1.4);
    for (const size of new Set(labSize.values())) {
      const group = pool.pool.filter((e) => labSize.get(e.lab) === size).map((e) => counts.get(e.model) ?? 0);
      expect(Math.max(...group) - Math.min(...group)).toBeLessThanOrEqual(2);
    }
  });

  it('changes the lineup from one match to the next', () => {
    const counts = new Map<string, number>();
    const rng = new Rng(9);
    const first = pickLineup(pool, counts, rng);
    for (const e of first) counts.set(e.model, 1);
    const second = pickLineup(pool, counts, rng);
    expect(second.map((e) => e.model).sort()).not.toEqual(first.map((e) => e.model).sort());
  });
});
