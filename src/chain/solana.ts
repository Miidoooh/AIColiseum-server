import { createPublicKey, verify } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const TOKEN_PROGRAMS = ['spl-token', 'spl-token-2022'];

export function base58Decode(text: string): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('not base58');
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = value * 256n + BigInt(b);
  let out = '';
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function isWalletAddress(text: string): boolean {
  try {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text) && base58Decode(text).length === 32;
  } catch {
    return false;
  }
}

/** Checks a wallet's ed25519 signature over a UTF-8 message, as produced by Phantom's signMessage. */
export function verifyWalletSignature(wallet: string, message: string, signature: Uint8Array): boolean {
  if (!isWalletAddress(wallet) || signature.length !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(base58Decode(wallet))]), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signature));
}

export interface Rpc {
  call<T>(method: string, params: unknown[]): Promise<T>;
}

export function createRpc(url: string, fetchImpl: typeof fetch = fetch): Rpc {
  let id = 0;
  return {
    async call<T>(method: string, params: unknown[]): Promise<T> {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Solana RPC ${method}: HTTP ${res.status}`);
      const data = (await res.json()) as { result?: T; error?: { message?: string } };
      if (data.error) throw new Error(`Solana RPC ${method}: ${data.error.message ?? 'error'}`);
      return data.result as T;
    },
  };
}

export async function getMintInfo(rpc: Rpc, mint: string): Promise<{ decimals: number; program: string }> {
  const info = await rpc.call<{ value: { owner: string; data: { parsed?: { info?: { decimals?: number } } } } | null }>('getAccountInfo', [
    mint,
    { encoding: 'jsonParsed' },
  ]);
  const decimals = info.value?.data.parsed?.info?.decimals;
  if (!info.value || decimals === undefined) throw new Error(`Mint ${mint} not found`);
  return { decimals, program: info.value.owner };
}

/** How many whole tokens of `mint` a wallet holds, across all its token accounts. */
export async function getHolding(rpc: Rpc, owner: string, mint: string): Promise<number> {
  const res = await rpc.call<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] }>(
    'getTokenAccountsByOwner',
    [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
  );
  return res.value.reduce((sum, a) => sum + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

export interface VerifiedBurn {
  signature: string;
  owner: string;
  /** Whole tokens burned of the expected mint. */
  amount: number;
  memo: string;
  blockTime: number | null;
}

interface ParsedInstruction {
  program?: string;
  parsed?: unknown;
}

interface ParsedTransaction {
  blockTime: number | null;
  meta: { err: unknown; innerInstructions?: { instructions: ParsedInstruction[] }[] } | null;
  transaction: { message: { instructions: ParsedInstruction[] } };
}

/** Reads a confirmed transaction and extracts the burn of `mint` and its memo. Waits for confirmation when needed. */
export async function verifyBurn(
  rpc: Rpc,
  signature: string,
  mint: string,
  decimals: number,
  opts: { attempts?: number; delayMs?: number; maxAgeSec?: number; now?: () => number } = {},
): Promise<VerifiedBurn> {
  const attempts = opts.attempts ?? 20;
  const now = opts.now ?? (() => Date.now());
  let tx: ParsedTransaction | null = null;
  for (let i = 0; i < attempts && !tx; i++) {
    tx = await rpc.call<ParsedTransaction | null>('getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
    ]);
    if (!tx && i < attempts - 1) await new Promise((r) => setTimeout(r, opts.delayMs ?? 3000));
  }
  if (!tx) throw new Error('The transaction is not confirmed on Solana yet. Try again in a minute.');
  if (!tx.meta || tx.meta.err) throw new Error('That transaction failed on Solana, so nothing was burned.');
  const maxAge = opts.maxAgeSec ?? 1800;
  if (tx.blockTime && now() / 1000 - tx.blockTime > maxAge) throw new Error('That burn is too old to use.');

  const all = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((i) => i.instructions)];
  let raw = 0n;
  let owner: string | null = null;
  let memo = '';
  for (const ix of all) {
    if (ix.program === 'spl-memo' && typeof ix.parsed === 'string') memo = ix.parsed;
    if (!ix.program || !TOKEN_PROGRAMS.includes(ix.program)) continue;
    const parsed = ix.parsed as { type?: string; info?: Record<string, unknown> } | undefined;
    if (parsed?.type !== 'burn' && parsed?.type !== 'burnChecked') continue;
    const info = parsed.info ?? {};
    if (info.mint !== mint) continue;
    const amount = (info.tokenAmount as { amount?: string } | undefined)?.amount ?? (info.amount as string | undefined) ?? '0';
    raw += BigInt(amount);
    owner = (info.authority as string | undefined) ?? (info.multisigAuthority as string | undefined) ?? owner;
  }
  if (!owner || raw === 0n) throw new Error('No burn of the Colosseum token was found in that transaction.');
  const amount = Number(raw / 10n ** BigInt(decimals));
  return { signature, owner, amount, memo, blockTime: tx.blockTime };
}
