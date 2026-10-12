import type { BurnLedger } from '../chain/ledger';
import { verifyBurn, type Rpc } from '../chain/solana';
import type { PaidEvent } from '../engine/schedule';
import { WARDEN_ACTION_TEXT, parseWardenMemo, shortWallet } from '../shared/crowd';
import type { LiveStatus } from '../shared/types';
import type { TokenInfo } from './token-config';

export interface WardenReceipt {
  action: string;
  target?: string;
  payer: string;
  burned: number;
}

/** Turns verified burns into Warden events for the match in progress. */
export class WardenDesk {
  private queue: PaidEvent[] = [];

  constructor(
    private readonly rpc: Rpc,
    private readonly token: TokenInfo,
    private readonly ledger: BurnLedger,
    private readonly verify: typeof verifyBurn = verifyBurn,
  ) {}

  take(): PaidEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  async redeem(signature: string, status: LiveStatus): Promise<WardenReceipt> {
    if (status.phase !== 'running' && status.phase !== 'intermission') throw new Error('No match is running right now, so the Warden is not listening.');
    if (await this.ledger.has(signature)) throw new Error('That burn has already been used.');
    const { decimals } = await this.token.mintInfo();
    const burn = await this.verify(this.rpc, signature, this.token.config.mint, decimals);
    const memo = parseWardenMemo(burn.memo);
    if (!memo) throw new Error('That burn is not marked for the Warden.');
    const price = this.token.config.warden[memo.action];
    if (burn.amount < price) throw new Error(`${WARDEN_ACTION_TEXT[memo.action].name} costs ${price.toLocaleString('en-US')} tokens; that burn was ${burn.amount.toLocaleString('en-US')}.`);
    if (!(await this.ledger.claim(signature, `warden:${memo.action}`))) throw new Error('That burn has already been used.');
    const payer = shortWallet(burn.owner);
    this.queue.push({ kind: memo.action, payer, ...(memo.target ? { target: memo.target } : {}) });
    return { action: memo.action, ...(memo.target ? { target: memo.target } : {}), payer, burned: burn.amount };
  }
}
