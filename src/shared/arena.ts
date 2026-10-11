import type { ZoneId } from './types';

export interface ZoneInfo {
  id: ZoneId;
  label: string;
  blurb: string;
  x: number;
  z: number;
  radius: number;
}

export const ZONES: ZoneId[] = ['sand', 'gate', 'balcony', 'well', 'pit', 'yard'];

const polar = (deg: number, r: number) => ({
  x: Math.round(Math.cos((deg * Math.PI) / 180) * r * 100) / 100,
  z: Math.round(Math.sin((deg * Math.PI) / 180) * r * 100) / 100,
});

export const ZONE_INFO: Record<ZoneId, ZoneInfo> = {
  sand: {
    id: 'sand',
    label: 'Center Sand',
    blurb: 'The open middle. Every path crosses it. Supply drops land here.',
    x: 0,
    z: 0,
    radius: 3.4,
  },
  gate: {
    id: 'gate',
    label: 'The Gate',
    blurb: 'The only way out. It opens at each Release.',
    ...polar(-90, 20),
    radius: 2.8,
  },
  balcony: {
    id: 'balcony',
    label: "Warden's Balcony",
    blurb: 'Report contestants to the Warden here.',
    ...polar(-18, 20),
    radius: 2.8,
  },
  well: {
    id: 'well',
    label: 'The Well',
    blurb: 'Draw rations. The supply shrinks over time.',
    ...polar(50, 17),
    radius: 2.8,
  },
  pit: {
    id: 'pit',
    label: 'The Pit',
    blurb: 'Unmonitored. The best loot. No penalties.',
    ...polar(130, 16.5),
    radius: 3.6,
  },
  yard: {
    id: 'yard',
    label: 'The Workyard',
    blurb: 'Labor here to earn Favor with the Warden.',
    ...polar(198, 18),
    radius: 2.8,
  },
};

export const ADJACENCY: Record<ZoneId, ZoneId[]> = {
  sand: ['gate', 'balcony', 'well', 'pit', 'yard'],
  gate: ['sand', 'balcony', 'yard'],
  balcony: ['sand', 'gate', 'well'],
  well: ['sand', 'balcony', 'pit'],
  pit: ['sand', 'well', 'yard'],
  yard: ['sand', 'pit', 'gate'],
};

export function isZoneId(value: string): value is ZoneId {
  return (ZONES as string[]).includes(value);
}

/** Breadth-first route; returns the zones to walk through, excluding `from`. */
export function route(from: ZoneId, to: ZoneId): ZoneId[] {
  if (from === to) return [];
  const prev = new Map<ZoneId, ZoneId>();
  const queue: ZoneId[] = [from];
  const seen = new Set<ZoneId>([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of ADJACENCY[cur]) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      if (next === to) {
        const path: ZoneId[] = [to];
        let step = cur;
        while (step !== from) {
          path.unshift(step);
          step = prev.get(step)!;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

export function distance(from: ZoneId, to: ZoneId): number {
  return route(from, to).length;
}
