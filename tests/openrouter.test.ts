import { describe, expect, it, vi } from 'vitest';
import { chatCompletion } from '../src/agents/openrouter';

function mockFetch() {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"wait"}' } }] }), { status: 200 }),
  );
}

const sentBody = (fetchImpl: ReturnType<typeof mockFetch>) => JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));

describe('chatCompletion', () => {
  it('leaves temperature out for models that reject it', async () => {
    const fetchImpl = mockFetch();
    await chatCompletion({ apiKey: 'k', model: 'openai/x', messages: [], maxTokens: 10, reasoning: 'low', fetchImpl });
    const body = sentBody(fetchImpl);
    expect(body).not.toHaveProperty('temperature');
    expect(body.reasoning).toEqual({ effort: 'low' });
  });

  it('sends temperature when given', async () => {
    const fetchImpl = mockFetch();
    const reply = await chatCompletion({ apiKey: 'k', model: 'x', messages: [], maxTokens: 10, temperature: 0.8, fetchImpl });
    expect(sentBody(fetchImpl).temperature).toBe(0.8);
    expect(reply).toBe('{"action":"wait"}');
  });
});
