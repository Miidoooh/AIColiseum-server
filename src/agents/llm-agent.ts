import type { Agent, AgentDecision, Observation } from './agent';
import { chatCompletion, type ChatMessage } from './openrouter';
import { parseTurn } from './parse';
import { renderObservation, rulesCard } from './prompt';

export interface LlmAgentOptions {
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature?: number;
  reasoning?: 'low' | 'medium' | 'high';
  /** Character and strategy written by a holder for their gladiator. House AIs have none. */
  persona?: string;
  fetchImpl?: typeof fetch;
}

/** A fighter driven by a hosted model. Each tick is a fresh, bounded prompt: rules + observation + its own notes. */
export class LlmAgent implements Agent {
  readonly kind = 'llm' as const;

  constructor(private readonly opts: LlmAgentOptions) {}

  async decide(obs: Observation, signal: AbortSignal): Promise<AgentDecision> {
    const rules = rulesCard(obs.self.name, obs.roster.length, obs.config);
    const system = this.opts.persona ? `${rules}\n\nYOUR CHARACTER (written by the holder who entered you into the Colosseum)\n${this.opts.persona}` : rules;
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: renderObservation(obs) },
    ];
    const first = await this.complete(messages, signal);
    const parsed = parseTurn(first, obs);
    if (parsed.ok) return { action: parsed.value, raw: first };

    messages.push(
      { role: 'assistant', content: first || '(empty reply)' },
      { role: 'user', content: `That reply could not be used: ${parsed.error}. Reply again with only the JSON object.` },
    );
    const second = await this.complete(messages, signal);
    const retry = parseTurn(second, obs);
    return retry.ok ? { action: retry.value, raw: second } : { action: null, raw: second || first, error: retry.error };
  }

  private complete(messages: ChatMessage[], signal: AbortSignal): Promise<string> {
    return chatCompletion({
      apiKey: this.opts.apiKey,
      model: this.opts.model,
      messages,
      maxTokens: this.opts.maxTokens,
      temperature: this.opts.temperature,
      reasoning: this.opts.reasoning,
      signal,
      fetchImpl: this.opts.fetchImpl,
    });
  }
}
