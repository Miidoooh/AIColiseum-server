import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadLiveSwitch, parseLiveSwitch } from '../src/server/live-switch';

describe('live switch', () => {
  it('reads running, season and the paused message', () => {
    expect(parseLiveSwitch({ running: true, season: 2 })).toEqual({ running: true, season: 2, pausedMessage: 'The Colosseum opens soon.' });
  });

  it('rejects a season that is not a positive whole number', () => {
    expect(() => parseLiveSwitch({ running: true, season: 0 })).toThrow(/live\.json/);
  });

  it('the committed switch is valid, so a deploy never crashes on it', () => {
    const live = loadLiveSwitch(fileURLToPath(new URL('../config/live.json', import.meta.url)));
    expect(typeof live.running).toBe('boolean');
    expect(live.season).toBeGreaterThanOrEqual(1);
  });
});
