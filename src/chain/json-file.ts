import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A small JSON document on disk with serialized, atomic updates. */
export class JsonFile<T> {
  private queue: Promise<unknown> = Promise.resolve();
  private cache: T | null = null;

  constructor(
    private readonly path: string,
    private readonly fallback: () => T,
  ) {}

  async read(): Promise<T> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(this.path, 'utf8')) as T;
    } catch {
      this.cache = this.fallback();
    }
    return this.cache;
  }

  update<R>(fn: (doc: T) => R): Promise<R> {
    const run = this.queue.then(async () => {
      const doc = await this.read();
      const result = fn(doc);
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(doc), 'utf8');
      await rename(tmp, this.path);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
