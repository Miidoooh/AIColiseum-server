import { readFileSync } from 'node:fs';
import { z } from 'zod';

const LiveSwitchSchema = z.object({
  /** When false the server starts no matches, so the models are never called. */
  running: z.boolean(),
  /** Each season keeps its own recordings; a new season starts with an empty leaderboard. */
  season: z.number().int().min(1),
  pausedMessage: z.string().min(1).default('The Colosseum opens soon.'),
});

export type LiveSwitch = z.infer<typeof LiveSwitchSchema>;

export function parseLiveSwitch(raw: unknown): LiveSwitch {
  const parsed = LiveSwitchSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid config/live.json: ${parsed.error.message}`);
  return parsed.data;
}

export function loadLiveSwitch(path: string): LiveSwitch {
  return parseLiveSwitch(JSON.parse(readFileSync(path, 'utf8')));
}
