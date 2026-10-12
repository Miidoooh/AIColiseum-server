import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEntrants, loadRoster } from '../src/agents/roster';

describe('the roster', () => {
  const roster = loadRoster(fileURLToPath(new URL('../config/roster.json', import.meta.url)));

  it('fields eight real models, each with its own name, colour and company', () => {
    expect(roster).toHaveLength(8);
    expect(new Set(roster.map((r) => r.name)).size).toBe(8);
    expect(new Set(roster.map((r) => r.color)).size).toBe(8);
    expect(new Set(roster.map((r) => r.lab)).size).toBe(8);
  });

  it('builds a model-driven agent for every slot', () => {
    const entrants = createEntrants(roster, { apiKey: 'test-key', maxTokens: 4000, temperature: 0.8 });
    expect(entrants.every((e) => e.agent.kind === 'llm')).toBe(true);
    expect(entrants.map((e) => e.name)).toEqual(roster.map((r) => r.name));
  });
});
