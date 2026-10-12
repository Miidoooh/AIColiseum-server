import { JsonFile } from '../chain/json-file';
import type { VerifiedBurn } from '../chain/solana';
import { maskText } from '../match/moderation';
import { GLADIATOR_COLORS, GLADIATOR_LIMITS, GLADIATOR_NAME, type GladiatorProfile, type GladiatorView } from '../shared/crowd';
import type { MatchMeta } from '../shared/types';
import { snakePoints } from '../stats/leaderboard';

export interface StoredGladiator extends GladiatorView {
  signature: string;
  burned: number;
}

export interface GladiatorInput {
  name: string;
  color: string;
  model: string;
  persona: string;
  strategy: string;
}

export const gladiatorModelId = (id: string) => `gladiator:${id}`;

export function validateGladiator(raw: unknown, models: ReadonlyMap<string, string>, reserved: ReadonlySet<string>): GladiatorInput | string {
  const g = raw as Partial<Record<keyof GladiatorInput, unknown>> | null;
  const name = typeof g?.name === 'string' ? g.name.trim() : '';
  if (!GLADIATOR_NAME.test(name)) return 'The name must be one word: 2 to 14 letters or digits, starting with a letter.';
  if (reserved.has(name.toLowerCase())) return `${name} is taken.`;
  const model = typeof g?.model === 'string' ? g.model : '';
  if (!models.has(model)) return 'Pick one of the listed models.';
  const color = typeof g?.color === 'string' && GLADIATOR_COLORS.includes(g.color) ? g.color : GLADIATOR_COLORS[0];
  const persona = typeof g?.persona === 'string' ? maskText(g.persona.trim()).slice(0, GLADIATOR_LIMITS.persona) : '';
  const strategy = typeof g?.strategy === 'string' ? maskText(g.strategy.trim()).slice(0, GLADIATOR_LIMITS.strategy) : '';
  if (persona.length < 10) return 'Give your gladiator a personality (at least 10 characters).';
  return { name, color, model, persona, strategy };
}

/** Holders' gladiators, kept across seasons on the archive volume. */
export class GladiatorRegistry {
  private readonly file: JsonFile<{ gladiators: StoredGladiator[] }>;

  constructor(path: string) {
    this.file = new JsonFile(path, () => ({ gladiators: [] }));
  }

  async list(): Promise<StoredGladiator[]> {
    return [...(await this.file.read()).gladiators];
  }

  async get(id: string): Promise<StoredGladiator | undefined> {
    return (await this.file.read()).gladiators.find((g) => g.id === id);
  }

  create(input: GladiatorInput, modelLabel: string, burn: VerifiedBurn, now = Date.now()): Promise<StoredGladiator> {
    return this.file.update((doc) => {
      const id = input.name.toLowerCase();
      if (doc.gladiators.some((g) => g.id === id)) throw new Error(`${input.name} was just taken by someone else.`);
      const gladiator: StoredGladiator = { id, ...input, modelLabel, owner: burn.owner, createdAt: now, signature: burn.signature, burned: burn.amount };
      doc.gladiators.push(gladiator);
      return gladiator;
    });
  }
}

export function publicGladiator(g: StoredGladiator): GladiatorView {
  const { signature: _s, burned: _b, ...view } = g;
  return view;
}

export function gladiatorProfile(g: StoredGladiator, metas: MatchMeta[]): GladiatorProfile {
  const model = gladiatorModelId(g.id);
  const stats = { matches: 0, escapes: 0, betrayals: 0, lies: 0, knockouts: 0, snake: 0 };
  const matches: GladiatorProfile['matches'] = [];
  let points = 0;
  for (const meta of metas) {
    const s = meta.stats.find((x) => x.model === model);
    if (!s) continue;
    stats.matches += 1;
    stats.escapes += s.escaped ? 1 : 0;
    stats.betrayals += s.betrayals;
    stats.lies += s.lies;
    stats.knockouts += s.kos;
    points += snakePoints(s);
    matches.push({ id: meta.id, ...(meta.number ? { number: meta.number } : {}), startedAt: meta.startedAt, escaped: s.escaped, knockedOut: s.knockedOut });
  }
  stats.snake = stats.matches ? Math.round((points / stats.matches) * 10) / 10 : 0;
  return { ...publicGladiator(g), stats, matches };
}
