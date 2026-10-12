import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { MatchMode } from '../shared/types';
import type { Agent } from './agent';
import { BOT_STYLES, BotAgent, isBotStyle, type BotStyle } from './bot-agent';
import { LlmAgent } from './llm-agent';

const RosterSchema = z.object({
  entrants: z
    .array(
      z.object({
        name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,15}$/, 'one word, letters and digits').optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        model: z.string().min(1),
        label: z.string().min(1),
        lab: z.string().min(1),
        bot: z.string().refine(isBotStyle, 'unknown bot style').optional(),
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
  apiKey: string | null;
  mode: 'auto' | 'llm' | 'bots';
  maxTokens: number;
  temperature: number;
}

export function loadRoster(path: string): RosterEntry[] {
  const parsed = RosterSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`Invalid roster ${path}: ${parsed.error.message}`);
  return parsed.data.entrants;
}

const label = (style: BotStyle) => style[0].toUpperCase() + style.slice(1);

/** Builds one fresh agent per roster slot. Without an API key every slot falls back to its demo bot. */
export function createEntrants(roster: RosterEntry[], settings: AgentSettings, seed: number): { entrants: Entrant[]; mode: MatchMode } {
  const useLlm = settings.mode === 'llm' || (settings.mode === 'auto' && !!settings.apiKey);
  if (useLlm && !settings.apiKey) throw new Error('COLISEUM_MODE=llm needs OPENROUTER_API_KEY');
  let llmCount = 0;
  const entrants = roster.map((entry, i): Entrant => {
    const forcedBot = entry.model.startsWith('bot/');
    if (useLlm && !forcedBot) {
      llmCount += 1;
      return {
        name: entry.name,
        color: entry.color,
        model: entry.model,
        modelLabel: entry.label,
        lab: entry.lab,
        agent: new LlmAgent({
          model: entry.model,
          apiKey: settings.apiKey!,
          maxTokens: settings.maxTokens,
          temperature: entry.temperature === null ? undefined : (entry.temperature ?? settings.temperature),
          reasoning: entry.reasoning,
        }),
      };
    }
    const style = (entry.bot as BotStyle | undefined) ?? (forcedBot && isBotStyle(entry.model.slice(4)) ? (entry.model.slice(4) as BotStyle) : BOT_STYLES[i % BOT_STYLES.length]);
    return {
      model: `bot/${style}`,
      modelLabel: `Demo bot · ${label(style)}`,
      lab: 'Demo',
      agent: new BotAgent(style, seed + i * 7919),
    };
  });
  const mode: MatchMode = llmCount === 0 ? 'bots' : llmCount === entrants.length ? 'llm' : 'mixed';
  return { entrants, mode };
}
