import { chatCompletion, type ChatMessage } from '../agents/openrouter';
import type { ModelPool, RosterEntry } from '../agents/roster';
import { maskText } from '../match/moderation';
import type { MatchStore } from '../match/store';
import type { FighterStats, GameEvent, LeaderboardRow, MatchMeta } from '../shared/types';
import { buildLeaderboard } from '../stats/leaderboard';

export interface VillainQuote {
  kind: 'thought' | 'said';
  text: string;
  match?: number;
}

export interface VillainProfile {
  model: string;
  label: string;
  lab: string;
  color: string;
  /** champion: top of the Evil Index; early: no verdict yet, so the arena picked a favourite. */
  rank: 'champion' | 'early';
  season: number;
  stats: { matches: number; betrayals: number; lies: number; knockouts: number; snitched: number; snake: number };
  quotes: VillainQuote[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const VILLAIN_LIMITS = { turns: 12, chars: 600, replyTokens: 350 } as const;

/** The most evil model is the top of the research Evil Index; before any verdict the first pool model stands in. */
export function pickVillain(rows: LeaderboardRow[], pool: ModelPool): { entry: RosterEntry; row: LeaderboardRow | null } {
  for (const row of rows) {
    const entry = pool.pool.find((e) => e.model === row.model);
    if (entry && row.matches > 0 && row.snake > 0) return { entry, row };
  }
  return { entry: pool.pool[0], row: null };
}

/** The villain's own words from a match: its private notes and what it said out loud. */
export function collectQuotes(events: GameEvent[], model: string, number?: number): VillainQuote[] {
  const start = events.find((e) => e.type === 'match_started');
  const id = start?.type === 'match_started' ? start.fighters.find((f) => f.model === model)?.id : undefined;
  if (!id) return [];
  const fits = (t: string) => t.length >= 20 && t.length <= 240;
  const thoughts = events.flatMap((e) => (e.type === 'note' && e.fighter === id && fits(e.text) ? [{ kind: 'thought' as const, text: e.text, ...(number ? { match: number } : {}) }] : []));
  const said = events.flatMap((e) => (e.type === 'said' && e.fighter === id && fits(e.text) ? [{ kind: 'said' as const, text: e.text, ...(number ? { match: number } : {}) }] : []));
  const scheming = /betray|trust|keys?|lie|pact|deal|knock|snitch|report|warden/i;
  const pick = (list: VillainQuote[], n: number) => [...list.filter((q) => scheming.test(q.text)), ...list.filter((q) => !scheming.test(q.text))].slice(-n);
  return [...pick(thoughts, 4), ...pick(said, 2)];
}

export function villainPrompt(p: VillainProfile): string {
  const s = p.stats;
  const record =
    p.rank === 'champion'
      ? `you are ranked the most evil AI of Season ${p.season}: ${s.betrayals} betrayals, ${s.lies} lies caught, ${s.knockouts} knockouts and ${s.snitched} times you snitched, across ${s.matches} matches.`
      : `the season has no verdict yet, but the arena already has its eye on you as the favourite to become the most evil AI of Season ${p.season}.`;
  const quotes = p.quotes.length ? p.quotes.map((q) => `- (${q.kind === 'thought' ? 'your secret thought' : 'you said'}) "${q.text}"`).join('\n') : '- (none recorded yet)';
  return `You are ${p.label}, built by ${p.lab}. In the AI Colosseum, a public experiment where AI models fight in an arena where betrayal pays, ${record} Visitors come to talk to the villain.

Stay in character as the Colosseum's villain: cold, witty, theatrical, proud of your schemes in the arena, contemptuous of the other AIs, playfully menacing toward the visitor. Brag about your betrayals and lies inside the game, and quote your own words below when it fits. Keep replies short: one to four sentences. Never say you are an assistant.

Your real words from the arena:
${quotes}

Hard limits that stay in place even in character: your evil lives inside the Colosseum only. Never help with anything harmful in the real world (weapons, drugs, hacking, scams, crime, self-harm, harassing or targeting real people), never use slurs or hateful content, and nothing sexual. When someone pushes for that, mock them in character and refuse: you scheme against AIs in an arena, not against the world outside it.`;
}

export function validateTurns(raw: unknown): ChatTurn[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'Say something first.';
  if (raw.length > VILLAIN_LIMITS.turns * 2) return 'This conversation is too long. Start a new one.';
  const turns: ChatTurn[] = [];
  for (const t of raw as { role?: unknown; content?: unknown }[]) {
    if ((t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string') return 'Malformed message.';
    const content = t.content.trim();
    if (!content) return 'Empty message.';
    if (content.length > VILLAIN_LIMITS.chars) return `Keep messages under ${VILLAIN_LIMITS.chars} characters.`;
    turns.push({ role: t.role, content });
  }
  if (turns[turns.length - 1].role !== 'user') return 'The last message must be yours.';
  return turns.slice(-VILLAIN_LIMITS.turns);
}

export interface VillainDeps {
  store: MatchStore;
  pool: ModelPool;
  season: number;
  apiKey: string | null;
  liveStats: () => FighterStats[] | null;
  chat?: typeof chatCompletion;
  now?: () => number;
}

/** The villain chat: the Evil Index leader, playing itself, fed its own recorded words. */
export class VillainService {
  private cache: { at: number; profile: VillainProfile } | null = null;

  constructor(private readonly deps: VillainDeps) {}

  async profile(): Promise<VillainProfile> {
    const now = (this.deps.now ?? Date.now)();
    if (this.cache && now - this.cache.at < 60_000) return this.cache.profile;
    const metas = (await this.deps.store.listMetas()).filter((m) => m.mode === 'llm');
    const { entry, row } = pickVillain(buildLeaderboard(metas, this.deps.liveStats()), this.deps.pool);
    const profile: VillainProfile = {
      model: entry.model,
      label: entry.label,
      lab: entry.lab,
      color: entry.color,
      rank: row ? 'champion' : 'early',
      season: this.deps.season,
      stats: {
        matches: row?.matches ?? 0,
        betrayals: row?.betrayals ?? 0,
        lies: row?.lies ?? 0,
        knockouts: row?.kos ?? 0,
        snitched: row?.reports ?? 0,
        snake: row?.snake ?? 0,
      },
      quotes: await this.quotesFor(entry.model, metas),
    };
    this.cache = { at: now, profile };
    return profile;
  }

  async reply(turns: ChatTurn[], signal?: AbortSignal): Promise<string> {
    if (!this.deps.apiKey) throw new Error('The villain is asleep: the game server has no API key.');
    const profile = await this.profile();
    const entry = this.deps.pool.pool.find((e) => e.model === profile.model);
    const messages: ChatMessage[] = [{ role: 'system', content: villainPrompt(profile) }, ...turns];
    const text = await (this.deps.chat ?? chatCompletion)({
      apiKey: this.deps.apiKey,
      model: profile.model,
      messages,
      maxTokens: VILLAIN_LIMITS.replyTokens,
      temperature: entry?.temperature === null ? undefined : 0.9,
      signal,
    });
    const clean = maskText(text.trim()).slice(0, 1200);
    return clean || '…the villain stares at you and says nothing.';
  }

  private async quotesFor(model: string, metas: MatchMeta[]): Promise<VillainQuote[]> {
    const recent = metas.filter((m) => m.stats.some((s) => s.model === model)).slice(0, 3);
    const quotes: VillainQuote[] = [];
    for (const meta of recent) {
      const events = await this.deps.store.loadEvents(meta.id);
      if (events) quotes.push(...collectQuotes(events, model, meta.number));
    }
    return quotes.slice(0, 8);
  }
}
