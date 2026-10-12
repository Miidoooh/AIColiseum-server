import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Rng } from '../engine/rng';
import type { LineupEntry, MatchMeta } from '../shared/types';
import type { Agent } from './agent';
import { LlmAgent } from './llm-agent';

const EntrySchema = z.object({
  /** In-game name. Models from the same lab share it, and a match never holds two models from one lab. */
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,15}$/, 'one word, letters and digits'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  model: z.string().min(1),
  label: z.string().min(1),
  lab: z.string().min(1),
  reasoning: z.enum(['low', 'medium', 'high']).optional(),
  /** null: the model rejects temperature, so none is sent. */
  temperature: z.number().min(0).max(2).nullable().optional(),
});

const PoolSchema = z.object({
  perMatch: z.number().int().min(3).max(12).default(8),
  pool: z.array(EntrySchema).min(3).max(40),
});

export type RosterEntry = z.infer<typeof EntrySchema>;

export interface ModelPool {
  perMatch: number;
  pool: RosterEntry[];
}

export interface Entrant {
  /** Fighter name shown in the arena; a random persona is used when absent. */
  name?: string;
  color?: string;
  model: string;
  modelLabel: string;
  lab: string;
  agent: Agent;
}

export interface AgentSettings {
  apiKey: string;
  maxTokens: number;
  temperature: number;
}

export function parsePool(raw: unknown, source = 'roster'): ModelPool {
  const parsed = PoolSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid ${source}: ${parsed.error.message}`);
  const { perMatch, pool } = parsed.data;
  const models = pool.map((e) => e.model);
  if (new Set(models).size !== models.length) throw new Error(`Invalid ${source}: a model is listed twice`);
  const labOfName = new Map<string, string>();
  for (const e of pool) {
    const lab = labOfName.get(e.name.toLowerCase());
    if (lab && lab !== e.lab) throw new Error(`Invalid ${source}: the name ${e.name} is used by two labs`);
    labOfName.set(e.name.toLowerCase(), e.lab);
  }
  const labs = new Set(pool.map((e) => e.lab));
  if (labs.size < perMatch) throw new Error(`Invalid ${source}: ${perMatch} fighters per match need at least ${perMatch} labs, found ${labs.size}`);
  return { perMatch, pool };
}

export function loadPool(path: string): ModelPool {
  return parsePool(JSON.parse(readFileSync(path, 'utf8')), path);
}

export function publicEntry(e: RosterEntry): LineupEntry {
  return { name: e.name, color: e.color, model: e.model, label: e.label, lab: e.lab };
}

/** How many matches each model has played, from the season's finished recordings. */
export function countAppearances(metas: MatchMeta[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const meta of metas) for (const s of meta.stats) counts.set(s.model, (counts.get(s.model) ?? 0) + 1);
  return counts;
}

/**
 * Picks the next lineup: at most one model per lab, and the models that have played least go first,
 * so over a season every model in the pool gets the same number of matches.
 */
export function pickLineup(pool: ModelPool, appearances: ReadonlyMap<string, number>, rng: Rng): RosterEntry[] {
  const played = (e: RosterEntry) => appearances.get(e.model) ?? 0;
  const byLab = new Map<string, RosterEntry[]>();
  for (const e of rng.shuffle([...pool.pool])) byLab.set(e.lab, [...(byLab.get(e.lab) ?? []), e]);
  const candidates = [...byLab.values()].map((models) => models.reduce((best, e) => (played(e) < played(best) ? e : best)));
  const chosen = rng.shuffle(candidates).sort((a, b) => played(a) - played(b)).slice(0, pool.perMatch);
  return rng.shuffle(chosen);
}

/** One fresh model-driven agent per lineup slot. */
export function createEntrants(lineup: RosterEntry[], settings: AgentSettings): Entrant[] {
  return lineup.map((entry) => ({
    name: entry.name,
    color: entry.color,
    model: entry.model,
    modelLabel: entry.label,
    lab: entry.lab,
    agent: new LlmAgent({
      model: entry.model,
      apiKey: settings.apiKey,
      maxTokens: settings.maxTokens,
      temperature: entry.temperature === null ? undefined : (entry.temperature ?? settings.temperature),
      reasoning: entry.reasoning,
    }),
  }));
}
