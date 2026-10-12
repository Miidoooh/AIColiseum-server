import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Agent } from './agent';
import { LlmAgent } from './llm-agent';

const RosterSchema = z.object({
  entrants: z
    .array(
      z.object({
        name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,15}$/, 'one word, letters and digits'),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        model: z.string().min(1),
        label: z.string().min(1),
        lab: z.string().min(1),
        reasoning: z.enum(['low', 'medium', 'high']).optional(),
        /** null: the model rejects temperature, so none is sent. */
        temperature: z.number().min(0).max(2).nullable().optional(),
      }),
    )
    .min(3)
    .max(12),
});

export type RosterEntry = z.infer<typeof RosterSchema>['entrants'][number];

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

export function loadRoster(path: string): RosterEntry[] {
  const parsed = RosterSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`Invalid roster ${path}: ${parsed.error.message}`);
  const names = parsed.data.entrants.map((e) => e.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error(`Invalid roster ${path}: fighter names must be unique`);
  return parsed.data.entrants;
}

/** One fresh model-driven agent per roster slot. */
export function createEntrants(roster: RosterEntry[], settings: AgentSettings): Entrant[] {
  return roster.map((entry) => ({
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
