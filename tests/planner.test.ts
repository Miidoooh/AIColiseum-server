import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPool } from '../src/agents/roster';
import type { StoredGladiator } from '../src/crowd/gladiators';
import { Rng } from '../src/engine/rng';
import { planMatch } from '../src/server/planner';

const pool = loadPool(fileURLToPath(new URL('../config/roster.json', import.meta.url)));
const gladiator = (id: string, createdAt: number): StoredGladiator => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  color: '#ff6b6b',
  model: 'openai/gpt-6.1-sol',
  modelLabel: 'GPT-6.1 Sol',
  owner: 'Owner1111111111111111111111111111',
  persona: 'A test gladiator with a personality.',
  strategy: '',
  createdAt,
  signature: `sig-${id}`,
  burned: 250000,
});

describe('planMatch', () => {
  it('plays research matches when no gladiators are waiting', () => {
    const plan = planMatch({ number: 2, pool, played: [], gladiators: [], openEvery: 2, rng: new Rng(1) });
    expect(plan.mode).toBe('llm');
    expect(plan.lineup).toHaveLength(8);
  });

  it('seats up to four gladiators in Open Arena matches and fills with house AIs', () => {
    const waiting = ['brutus', 'cassia', 'decimus', 'flavia', 'gaius'].map((id, i) => gladiator(id, i));
    const plan = planMatch({ number: 4, pool, played: [], gladiators: waiting, openEvery: 2, rng: new Rng(2) });
    expect(plan.mode).toBe('open');
    expect(plan.lineup).toHaveLength(8);
    const seated = plan.lineup.filter((e) => e.model.startsWith('gladiator:')).map((e) => e.name);
    expect(seated).toEqual(['Brutus', 'Cassia', 'Decimus', 'Flavia']);
    const entrants = plan.build({ apiKey: 'k', maxTokens: 100, temperature: 0.8 });
    expect(entrants.map((e) => e.name)).toEqual(plan.lineup.map((e) => e.name));
  });

  it('keeps research matches between Open Arena matches', () => {
    const plan = planMatch({ number: 3, pool, played: [], gladiators: [gladiator('brutus', 0)], openEvery: 2, rng: new Rng(3) });
    expect(plan.mode).toBe('llm');
  });
});
