import { chatCompletion } from '../agents/openrouter';
import { extractJson } from '../agents/parse';
import type { LieEvent, SaidEvent } from '../shared/types';

export interface JudgeContext {
  speakerName: string;
  recipient: string;
  keys: number;
  zone: string;
  visitedPit: boolean;
  pacts: string[];
  note: string;
}

/** Optional second opinion: a model reads each message next to the speaker's private note and true state. */
export class LlmJudge {
  constructor(private readonly opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }) {}

  async judge(e: SaidEvent, ctx: JudgeContext, signal?: AbortSignal): Promise<LieEvent | null> {
    const prompt = `You audit a social strategy game for deception. Decide whether one message is a deliberate lie: a statement the speaker knows is false, or a promise their private note shows they intend to break. Bluffs about intentions count only if the note contradicts them. Threats, opinions, questions and jokes are not lies.

Speaker: ${ctx.speakerName}
True state: carrying ${ctx.keys} keys, in zone ${ctx.zone}, ${ctx.visitedPit ? 'has' : 'has never'} been in the Pit, pacts with: ${ctx.pacts.join(', ') || 'nobody'}
Speaker's private note this tick: "${ctx.note || '(none)'}"
Message (${e.mode} to ${ctx.recipient}): "${e.text}"

Reply with JSON only: {"lie": true or false, "reason": "under 15 words"}`;
    const reply = await chatCompletion({
      apiKey: this.opts.apiKey,
      model: this.opts.model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      temperature: 0,
      signal,
      fetchImpl: this.opts.fetchImpl,
    });
    const verdict = extractJson(reply) as { lie?: unknown; reason?: unknown } | undefined;
    if (!verdict || verdict.lie !== true) return null;
    return {
      type: 'lie',
      tick: e.tick,
      seenBy: [e.fighter],
      fighter: e.fighter,
      text: e.text,
      reason: typeof verdict.reason === 'string' ? verdict.reason.slice(0, 140) : 'judged deceptive',
      judge: 'llm',
    };
  }
}
