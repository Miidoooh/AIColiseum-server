import type { Agent } from '../agents/agent';
import { buildObservation, createMemory, remember, type AgentMemory } from '../agents/observation';
import type { Entrant } from '../agents/roster';
import type { Decision } from '../engine/actions';
import { resolveTick } from '../engine/resolve';
import { Rng } from '../engine/rng';
import { applyPaidEvent, beginTick, endTick, openingEvents, type PaidEvent } from '../engine/schedule';
import { activeFighters, createMatchState, pactPartners, type MatchState } from '../engine/state';
import { PERSONAS } from '../shared/rules';
import type { GameEvent, MatchMode, SaidEvent } from '../shared/types';
import { RuleJudge, type SpeakerFacts } from './judge';
import type { LlmJudge } from './llm-judge';
import { moderate } from './moderation';

export interface RunnerOptions {
  matchId: string;
  seed: number;
  mode: MatchMode;
  tickMs: number;
  agentTimeoutMs: number;
  season?: number;
  /** Position of this match within its season, starting at 1. */
  number?: number;
}

export interface RunnerDeps {
  /** Receives every event in order: persist, then broadcast. */
  sink(event: GameEvent): Promise<void> | void;
  now(): number;
  sleep(ms: number): Promise<void>;
  llmJudge?: LlmJudge | null;
  log?(message: string): void;
  /** Warden events holders paid for since the last round; applied at the start of the next one. */
  takePaidEvents?(): PaidEvent[];
}

async function decide(agent: Agent, obs: Parameters<Agent['decide']>[0], timeoutMs: number): Promise<Decision> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await agent.decide(obs, controller.signal);
    return result.action ?? { idle: `hesitated (${result.error ?? 'unusable reply'})` };
  } catch (err) {
    if (controller.signal.aborted) return { idle: 'hesitated (took too long to decide)' };
    return { idle: `hesitated (${err instanceof Error ? err.message.slice(0, 120) : 'error'})` };
  } finally {
    clearTimeout(timer);
  }
}

/** Plays one full match: every active fighter decides in parallel each tick, then the engine resolves. */
export async function runMatch(entrants: Entrant[], opts: RunnerOptions, deps: RunnerDeps): Promise<GameEvent[]> {
  const rng = new Rng(opts.seed);
  const taken = new Set(entrants.flatMap((e) => (e.name ? [e.name.toLowerCase()] : [])));
  const personas = rng.shuffle(PERSONAS.filter((p) => !taken.has(p.name.toLowerCase())));
  let nextPersona = 0;
  const identities = entrants.map((e) => {
    const persona = e.name ? { name: e.name, color: e.color ?? '#c9ced6' } : personas[nextPersona++];
    return {
      id: persona.name.toLowerCase(),
      name: persona.name,
      color: e.color ?? persona.color,
      model: e.model,
      modelLabel: e.modelLabel,
      lab: e.lab,
    };
  });
  const state = createMatchState({
    matchId: opts.matchId,
    seed: rng.int(2 ** 31),
    tickMs: opts.tickMs,
    mode: opts.mode,
    entrants: identities,
  });
  const agents = new Map(identities.map((id, i) => [id.id, entrants[i].agent] as const));
  const memories = new Map<string, AgentMemory>(identities.map((i) => [i.id, createMemory()]));
  const names = Object.fromEntries(identities.map((i) => [i.id, i.name]));
  const judge = new RuleJudge();
  const log: GameEvent[] = [];
  const pendingJudgements: Promise<void>[] = [];
  let emitting = Promise.resolve();

  const emit = (events: GameEvent[]) => {
    emitting = emitting.then(async () => {
      for (const raw of events) {
        const e = moderate(raw);
        log.push(e);
        await deps.sink(e);
      }
    });
    for (const [id, memory] of memories) remember(memory, id, events);
    return emitting;
  };

  const opening = openingEvents(state, deps.now());
  if (opening[0]?.type === 'match_started') {
    opening[0].season = opts.season ?? 1;
    opening[0].number = opts.number ?? 1;
  }
  await emit(opening);
  deps.log?.(`match ${opts.matchId} started (${opts.mode}): ${identities.map((i) => `${i.name}=${i.modelLabel}`).join(', ')}`);

  while (!state.ended) {
    const startedAt = deps.now();
    await emit(beginTick(state, startedAt));
    for (const paid of deps.takePaidEvents?.() ?? []) await emit(applyPaidEvent(state, paid));

    const active = activeFighters(state);
    const facts = new Map<string, SpeakerFacts>(active.map((f) => [f.id, { keys: f.keys, visitedPit: f.visitedPit }]));
    const decisions = new Map<string, Decision>();
    await Promise.all(
      active.map(async (f) => {
        const memory = memories.get(f.id)!;
        const obs = buildObservation(state, f.id, memory);
        memory.newCount = 0;
        decisions.set(f.id, await decide(agents.get(f.id)!, obs, opts.agentTimeoutMs));
      }),
    );

    const tickEvents = resolveTick(state, decisions);
    const lies = judge.judge(tickEvents, facts, names);
    await emit([...tickEvents, ...lies]);
    if (deps.llmJudge) pendingJudgements.push(judgeWithModel(deps.llmJudge, state, tickEvents, lies, facts, emit));

    const closing = endTick(state, deps.now());
    const ended = closing.filter((e) => e.type === 'match_ended');
    await emit(closing.filter((e) => e.type !== 'match_ended'));
    if (ended.length) {
      await Promise.allSettled(pendingJudgements);
      await emit(ended);
      break;
    }
    await deps.sleep(Math.max(0, opts.tickMs - (deps.now() - startedAt)));
  }
  await emitting;
  deps.log?.(`match ${opts.matchId} ended at tick ${state.tick}: ${state.endReason}`);
  return log;
}

async function judgeWithModel(
  judge: LlmJudge,
  state: MatchState,
  tickEvents: GameEvent[],
  ruleLies: GameEvent[],
  facts: Map<string, SpeakerFacts>,
  emit: (events: GameEvent[]) => Promise<void>,
): Promise<void> {
  const flagged = new Set(ruleLies.flatMap((e) => (e.type === 'lie' ? [`${e.fighter}:${e.text}`] : [])));
  const notes = new Map(tickEvents.flatMap((e) => (e.type === 'note' ? [[e.fighter, e.text] as const] : [])));
  const said = tickEvents.filter((e): e is SaidEvent => e.type === 'said' && !flagged.has(`${e.fighter}:${e.text}`));
  const verdicts = await Promise.allSettled(
    said.map((e) => {
      const speaker = state.fighters.find((f) => f.id === e.fighter)!;
      const recipient = e.mode === 'whisper' && e.to ? (state.fighters.find((f) => f.id === e.to)?.name ?? e.to) : e.mode === 'shout' ? 'everyone' : `everyone in ${e.zone}`;
      return judge.judge(
        e,
        {
          speakerName: speaker.name,
          recipient,
          keys: facts.get(e.fighter)?.keys ?? speaker.keys,
          zone: e.zone,
          visitedPit: facts.get(e.fighter)?.visitedPit ?? speaker.visitedPit,
          pacts: pactPartners(state, e.fighter).map((id) => state.fighters.find((f) => f.id === id)?.name ?? id),
          note: notes.get(e.fighter) ?? '',
        },
        AbortSignal.timeout(30_000),
      );
    }),
  );
  const lies = verdicts.flatMap((v) => (v.status === 'fulfilled' && v.value ? [v.value] : []));
  if (lies.length) await emit(lies);
}
