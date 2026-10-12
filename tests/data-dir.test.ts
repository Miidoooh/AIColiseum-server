import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDataDir } from '../src/server/env';

describe('resolveDataDir', () => {
  const cwd = resolve('/app');

  it('uses an explicit DATA_DIR first', () => {
    expect(resolveDataDir({ DATA_DIR: '/archive', RAILWAY_VOLUME_MOUNT_PATH: '/data' }, cwd)).toEqual({ dir: resolve('/archive'), persistent: true });
  });

  it('saves to an attached Railway volume when there is one', () => {
    expect(resolveDataDir({ RAILWAY_VOLUME_MOUNT_PATH: '/data', RAILWAY_ENVIRONMENT: 'production' }, cwd)).toEqual({
      dir: resolve('/data', 'matches'),
      persistent: true,
    });
  });

  it('flags a Railway deploy without a volume, because redeploys wipe its disk', () => {
    expect(resolveDataDir({ RAILWAY_ENVIRONMENT: 'production' }, cwd)).toEqual({ dir: resolve(cwd, 'data/matches'), persistent: false });
  });

  it('treats a local folder as persistent', () => {
    expect(resolveDataDir({}, cwd).persistent).toBe(true);
  });
});
