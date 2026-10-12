import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const ROUTES: Record<string, string> = { '/': 'index.html', '/arena': 'arena.html' };

/** Serves the built client. Paths are normalised and confined to `root` to block directory traversal. */
export async function serveStatic(res: ServerResponse, root: string, pathname: string): Promise<void> {
  const base = resolve(root);
  let relative: string;
  try {
    relative = ROUTES[pathname] ?? decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const file = resolve(base, normalize(relative));
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    const indexExists = await stat(join(base, 'index.html')).catch(() => null);
    if (!indexExists) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('AI Colosseum game server is running. Live data: /api/status. No website build here; the site is served separately.');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
  createReadStream(file).pipe(res);
}
