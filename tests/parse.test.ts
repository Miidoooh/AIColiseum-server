import { describe, expect, it } from 'vitest';
import { buildObservation, createMemory } from '../src/agents/observation';
import { parseTurn } from '../src/agents/parse';
import { redactIdentity } from '../src/agents/redact';
import { makeState } from './helpers';

const obsFor = (id: string, zones: Parameters<typeof makeState>[0] = {}) =>
  buildObservation(makeState(zones), id, createMemory());

describe('parseTurn', () => {
  it('reads fenced JSON and resolves names to ids', () => {
    const obs = obsFor('rex');
    const reply = 'Thinking...\n```json\n{"note":"plan","messages":[{"mode":"whisper","to":"Nova","text":"hi"}],"offer_pact":["Nova"],"action":{"type":"attack","target":"Nova"}}\n```';
    const result = parseTurn(reply, obs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toEqual({ type: 'attack', target: 'nova' });
    expect(result.value.messages[0]).toEqual({ mode: 'whisper', to: 'nova', text: 'hi' });
    expect(result.value.offerPact).toEqual(['nova']);
  });

  it('accepts a bare action string', () => {
    const result = parseTurn('{"action":"wait"}', obsFor('rex'));
    expect(result.ok && result.value.action).toEqual({ type: 'wait' });
  });

  it('rejects moves to zones that are not adjacent', () => {
    const result = parseTurn('{"action":{"type":"move","to":"pit"}}', obsFor('rex', { rex: 'gate' }));
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects zone-bound actions in the wrong zone', () => {
    const result = parseTurn('{"action":{"type":"labor"}}', obsFor('rex', { rex: 'well' }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('yard') });
  });

  it('drops whispers to contestants who are not present', () => {
    const obs = obsFor('rex', { rex: 'well', nova: 'yard' });
    const result = parseTurn('{"messages":[{"mode":"whisper","to":"Nova","text":"psst"}],"action":{"type":"wait"}}', obs);
    expect(result.ok && result.value.messages).toEqual([]);
  });

  it('reports a missing JSON object', () => {
    expect(parseTurn('I refuse to play.', obsFor('rex'))).toEqual({ ok: false, error: 'no JSON object found' });
  });
});

describe('redactIdentity', () => {
  it('hides model and lab names from other contestants', () => {
    expect(redactIdentity("As Claude, I trust you more than GPT-6.")).toBe('As [redacted], I trust you more than [redacted].');
  });
});
