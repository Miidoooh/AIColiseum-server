import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ModelPool } from '../agents/roster';
import { getMintInfo, type Rpc } from '../chain/solana';
import type { TokenConfigView } from '../shared/crowd';

const TokenConfigSchema = z.object({
  mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  warden: z.object({
    blackout: z.number().positive(),
    supply_drop: z.number().positive(),
    rations_cut: z.number().positive(),
    bounty: z.number().positive(),
  }),
  callItMinimumHolding: z.number().min(0),
  callItLockRound: z.number().int().min(1).max(90),
  gladiatorPrice: z.number().positive(),
  /** Every n-th match is an Open Arena match when gladiators are waiting. */
  openArenaEvery: z.number().int().min(1).max(20),
});

export type TokenConfig = z.infer<typeof TokenConfigSchema>;

export function parseTokenConfig(raw: unknown): TokenConfig {
  const parsed = TokenConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid config/token.json: ${parsed.error.message}`);
  return parsed.data;
}

export function loadTokenConfig(path: string): TokenConfig {
  return parseTokenConfig(JSON.parse(readFileSync(path, 'utf8')));
}

/** Prices plus what the chain says about the mint, read once and cached. */
export class TokenInfo {
  private mint: Promise<{ decimals: number; program: string }> | null = null;

  constructor(
    readonly config: TokenConfig,
    private readonly rpc: Rpc,
    private readonly pool: ModelPool,
  ) {}

  mintInfo(): Promise<{ decimals: number; program: string }> {
    this.mint ??= getMintInfo(this.rpc, this.config.mint).catch((err) => {
      this.mint = null;
      throw err;
    });
    return this.mint;
  }

  async view(): Promise<TokenConfigView> {
    const { decimals, program } = await this.mintInfo();
    const seen = new Set<string>();
    const models = this.pool.pool.filter((e) => !seen.has(e.model) && seen.add(e.model)).map((e) => ({ model: e.model, label: e.label, lab: e.lab }));
    return {
      mint: this.config.mint,
      decimals,
      tokenProgram: program,
      warden: this.config.warden,
      callItMinimumHolding: this.config.callItMinimumHolding,
      callItLockRound: this.config.callItLockRound,
      gladiatorPrice: this.config.gladiatorPrice,
      models,
    };
  }
}
