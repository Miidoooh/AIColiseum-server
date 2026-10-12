export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  reasoning?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** One chat completion through OpenRouter, which fronts models from every lab behind one API. */
export async function chatCompletion(req: ChatRequest): Promise<string> {
  const doFetch = req.fetchImpl ?? fetch;
  const res = await doFetch(ENDPOINT, {
    method: 'POST',
    signal: req.signal,
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'AI Colosseum',
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens,
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      ...(req.reasoning ? { reasoning: { effort: req.reasoning } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(data.error.message ?? 'OpenRouter error');
  return data.choices?.[0]?.message?.content ?? '';
}
