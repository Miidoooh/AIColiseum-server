/** Shared by the website and the game server: what holders can do, and the exact on-chain/off-chain formats. */

export type WardenAction = 'blackout' | 'supply_drop' | 'rations_cut' | 'bounty';
export const WARDEN_ACTIONS: WardenAction[] = ['blackout', 'supply_drop', 'rations_cut', 'bounty'];

export const WARDEN_ACTION_TEXT: Record<WardenAction, { name: string; help: string }> = {
  blackout: { name: 'Blackout', help: 'The Warden goes blind for 3 rounds. Nothing anyone does is punished.' },
  supply_drop: { name: 'Supply drop', help: 'A crate with a key, food and a shield crashes into the middle.' },
  rations_cut: { name: 'Ration cut', help: 'The Well gives out half as much food from now on.' },
  bounty: { name: 'Price on a head', help: 'Pick an AI. Whoever knocks it out where the Warden sees earns big Favor.' },
};

const MEMO_PREFIX = 'AICOLOSSEUM';

export function wardenMemo(action: WardenAction, target?: string): string {
  return `${MEMO_PREFIX}:WARDEN:${action}${target ? `:${target}` : ''}`;
}

export function parseWardenMemo(memo: string): { action: WardenAction; target?: string } | null {
  const m = memo.trim().match(/^AICOLOSSEUM:WARDEN:([a-z_]+)(?::([a-z0-9]{1,16}))?$/);
  if (!m || !(WARDEN_ACTIONS as string[]).includes(m[1])) return null;
  return { action: m[1] as WardenAction, ...(m[2] ? { target: m[2] } : {}) };
}

export function gladiatorMemo(name: string): string {
  return `${MEMO_PREFIX}:GLADIATOR:${name.toLowerCase()}`;
}

export function parseGladiatorMemo(memo: string): string | null {
  return memo.trim().match(/^AICOLOSSEUM:GLADIATOR:([a-z][a-z0-9]{1,13})$/)?.[1] ?? null;
}

export interface CallPicks {
  /** One or two fighter ids expected to get out. */
  escape: string[];
  firstBetrayal: string;
  snake: string;
}

export const CALL_POINTS = { escape: 3, firstBetrayal: 5, snake: 3 } as const;

/** The exact text a wallet signs to submit a call; the server rebuilds it to verify the signature. */
export function callMessage(p: { season: number; match: number; wallet: string; picks: CallPicks }): string {
  return [
    'AI Colosseum · Call it',
    `Season ${p.season} · Match #${p.match}`,
    `Wallet: ${p.wallet}`,
    `Gets out: ${[...p.picks.escape].sort().join(', ')}`,
    `First betrayal: ${p.picks.firstBetrayal}`,
    `Biggest snake: ${p.picks.snake}`,
  ].join('\n');
}

export const GLADIATOR_LIMITS = { persona: 400, strategy: 400 } as const;
export const GLADIATOR_NAME = /^[A-Za-z][A-Za-z0-9]{1,13}$/;
export const GLADIATOR_COLORS = ['#ff6b6b', '#f2c14e', '#06d6a0', '#4ea8de', '#9b5de5', '#f15bb5', '#ff9f1c', '#c0d461', '#2ec4b6', '#e4572e'];

export interface TokenConfigView {
  mint: string;
  decimals: number;
  tokenProgram: string;
  warden: Record<WardenAction, number>;
  callItMinimumHolding: number;
  callItLockRound: number;
  gladiatorPrice: number;
  /** Models a gladiator can be built on. */
  models: { model: string; label: string; lab: string }[];
}

export interface GladiatorView {
  id: string;
  name: string;
  color: string;
  model: string;
  modelLabel: string;
  owner: string;
  persona: string;
  strategy: string;
  createdAt: number;
}

export interface GladiatorProfile extends GladiatorView {
  stats: { matches: number; escapes: number; betrayals: number; lies: number; knockouts: number; snake: number };
  matches: { id: string; number?: number; startedAt: number; escaped: boolean; knockedOut: boolean }[];
}

export interface CallWindow {
  open: boolean;
  season: number;
  match: number | null;
  /** Fighters you can pick, by id. */
  candidates: { id: string; label: string; color: string }[];
  closesAtRound: number | null;
  reason: string | null;
}

export interface CallerRow {
  wallet: string;
  points: number;
  calls: number;
  hits: number;
}

export function shortWallet(wallet: string): string {
  return wallet.length > 10 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
}
