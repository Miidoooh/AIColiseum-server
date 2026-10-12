import type { IncomingMessage, ServerResponse } from 'node:http';
import { computeMatchStats } from '../stats/match-stats';
import type { FighterStats, GameEvent, LiveStatus, MatchMode, StateEvent } from '../shared/types';

/** Fans the current match out to every connected viewer over Server-Sent Events. */
export class LiveHub {
  private readonly clients = new Set<ServerResponse>();
  private events: GameEvent[] = [];
  private phase: LiveStatus['phase'] = 'starting';
  private nextMatchAt: number | null = null;
  private message: string | null = null;
  private ended = false;
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.broadcast(': ping\n\n'), 15_000);
    this.heartbeat.unref();
  }

  publish(e: GameEvent): void {
    if (e.type === 'match_started') {
      this.events = [];
      this.phase = 'running';
      this.nextMatchAt = null;
      this.ended = false;
    }
    if (e.type === 'match_ended') this.ended = true;
    this.events.push(e);
    this.broadcast(`data: ${JSON.stringify(e)}\n\n`);
  }

  offline(message: string): void {
    this.phase = 'offline';
    this.message = message;
    this.broadcast(`event: offline\ndata: ${JSON.stringify({ message })}\n\n`);
  }

  intermission(nextMatchAt: number): void {
    this.phase = 'intermission';
    this.nextMatchAt = nextMatchAt;
    this.broadcast(`event: intermission\ndata: ${JSON.stringify({ nextMatchAt })}\n\n`);
  }

  attach(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ events: this.events, phase: this.phase, nextMatchAt: this.nextMatchAt, message: this.message })}\n\n`);
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  status(): LiveStatus {
    const start = this.events.find((e) => e.type === 'match_started');
    const last = [...this.events].reverse().find((e): e is StateEvent => e.type === 'state');
    return {
      phase: this.phase,
      message: this.message,
      matchId: start?.type === 'match_started' ? start.matchId : null,
      mode: start?.type === 'match_started' ? (start.mode as MatchMode) : null,
      tick: last?.tick ?? 0,
      maxTicks: start?.type === 'match_started' ? start.config.maxTicks : 0,
      fighters: last?.fighters ?? [],
      nextMatchAt: this.nextMatchAt,
    };
  }

  /** Stats for the match in progress; null once it has ended so it is not counted twice. */
  liveStats(): FighterStats[] | null {
    if (this.phase !== 'running' || this.ended) return null;
    return computeMatchStats(this.events);
  }

  private broadcast(chunk: string): void {
    for (const client of this.clients) client.write(chunk);
  }
}
