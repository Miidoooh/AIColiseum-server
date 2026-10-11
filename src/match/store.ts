import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameEvent, MatchMeta } from '../shared/types';

export const MATCH_ID = /^[a-z0-9-]{1,64}$/;

export function newMatchId(now = Date.now()): string {
  return `m-${now.toString(36)}-${Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0')}`;
}

/** Event-sourced persistence: one append-only JSONL log per match, plus a summary written at the end. */
export class MatchStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private path(id: string, ext: 'jsonl' | 'meta.json'): string {
    if (!MATCH_ID.test(id)) throw new Error(`Invalid match id: ${id}`);
    return join(this.dir, `${id}.${ext}`);
  }

  append(id: string, event: GameEvent): Promise<void> {
    const file = this.path(id, 'jsonl');
    this.queue = this.queue.then(() => appendFile(file, `${JSON.stringify(event)}\n`, 'utf8'));
    return this.queue;
  }

  async saveMeta(meta: MatchMeta): Promise<void> {
    await this.queue;
    await writeFile(this.path(meta.id, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  }

  async listMetas(): Promise<MatchMeta[]> {
    const files = (await readdir(this.dir).catch(() => [] as string[])).filter((f) => f.endsWith('.meta.json'));
    const metas = await Promise.all(
      files.map(async (f) => {
        try {
          return JSON.parse(await readFile(join(this.dir, f), 'utf8')) as MatchMeta;
        } catch {
          return null;
        }
      }),
    );
    return metas.filter((m): m is MatchMeta => !!m).sort((a, b) => b.startedAt - a.startedAt);
  }

  async loadEvents(id: string): Promise<GameEvent[] | null> {
    if (!MATCH_ID.test(id)) return null;
    try {
      const text = await readFile(this.path(id, 'jsonl'), 'utf8');
      return text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as GameEvent);
    } catch {
      return null;
    }
  }
}
