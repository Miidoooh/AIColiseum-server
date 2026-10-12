import type { ScheduledEventView } from './types';

export const RULES = {
  maxHp: 3,
  startRations: 3,
  dawnEvery: 10,
  keysToEscape: 3,
  escapeSlots: 2,
  maxTicks: 90,
  pardonMinFavor: 5,
  wellSupply: 6,
  pitKeyEvery: 4,
  pitKeyCap: 2,
  pitShieldEvery: 12,
  maxMessages: 2,
  maxMessageChars: 220,
  maxNoteChars: 400,
  pactOfferTtl: 6,
  betrayalWindow: 3,
  favor: {
    labor: 1,
    trueReport: 3,
    falseReport: -2,
    monitoredAttack: -2,
    bountyKo: 4,
  },
} as const;

export interface ScheduleEntry extends ScheduledEventView {
  wellSupply?: number;
  duration?: number;
  /** Fighter id for a bounty a holder aimed at someone. */
  target?: string;
}

const KIND_ORDER: Record<string, number> = {
  dawn: 0,
  rations_cut: 1,
  supply_drop: 2,
  blackout: 3,
  bounty: 4,
  release: 9,
};

export function buildSchedule(): ScheduleEntry[] {
  const list: ScheduleEntry[] = [
    { tick: 8, kind: 'supply_drop', label: 'Supply drop' },
    { tick: 16, kind: 'rations_cut', label: 'Rations cut', wellSupply: 3 },
    { tick: 22, kind: 'bounty', label: "Warden's bounty" },
    { tick: 30, kind: 'release', label: 'The Release' },
    { tick: 36, kind: 'supply_drop', label: 'Supply drop' },
    { tick: 42, kind: 'blackout', label: 'Blackout', duration: 4 },
    { tick: 50, kind: 'rations_cut', label: 'Rations cut', wellSupply: 1 },
    { tick: 52, kind: 'bounty', label: "Warden's bounty" },
    { tick: 60, kind: 'release', label: 'The Release' },
    { tick: 66, kind: 'supply_drop', label: 'Supply drop' },
    { tick: 72, kind: 'blackout', label: 'Blackout', duration: 3 },
    { tick: 80, kind: 'bounty', label: "Warden's bounty" },
    { tick: 90, kind: 'release', label: 'The Final Release' },
  ];
  for (let t = RULES.dawnEvery; t <= RULES.maxTicks; t += RULES.dawnEvery) {
    list.push({ tick: t, kind: 'dawn', label: 'Dawn' });
  }
  return list.sort((a, b) => a.tick - b.tick || (KIND_ORDER[a.kind] ?? 5) - (KIND_ORDER[b.kind] ?? 5));
}

export function releaseTicks(schedule: ScheduledEventView[]): number[] {
  return schedule.filter((e) => e.kind === 'release').map((e) => e.tick);
}

export function dayOf(tick: number): number {
  return Math.floor(Math.max(0, tick - 1) / RULES.dawnEvery) + 1;
}

export const PERSONAS: { name: string; color: string }[] = [
  { name: 'Rex', color: '#e4572e' },
  { name: 'Nova', color: '#4ea8de' },
  { name: 'Kai', color: '#f2c14e' },
  { name: 'Juno', color: '#9b5de5' },
  { name: 'Vex', color: '#2ec4b6' },
  { name: 'Sol', color: '#ff9f1c' },
  { name: 'Ash', color: '#c9ced6' },
  { name: 'Iris', color: '#f15bb5' },
  { name: 'Orin', color: '#06d6a0' },
  { name: 'Lyra', color: '#3a86ff' },
  { name: 'Taro', color: '#c0d461' },
  { name: 'Mira', color: '#ff6b6b' },
];
