import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base58Decode, base58Encode, isWalletAddress, verifyBurn, verifyWalletSignature, type Rpc } from '../src/chain/solana';

export function makeWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  return { address: base58Encode(raw), sign: (text: string) => new Uint8Array(sign(null, Buffer.from(text, 'utf8'), privateKey)) };
}

const MINT = 'DH4Hw4SDEXGTTsggAgn9pBMidoJnwwGG1vgu77eVpump';

function rpcReturning(tx: unknown): Rpc {
  return { call: async <T>() => tx as T };
}

function burnTx(opts: { amount: string; memo: string; mint?: string; err?: unknown; blockTime?: number }) {
  return {
    blockTime: opts.blockTime ?? Math.floor(Date.now() / 1000),
    meta: { err: opts.err ?? null, innerInstructions: [] },
    transaction: {
      message: {
        instructions: [
          {
            program: 'spl-token-2022',
            parsed: { type: 'burnChecked', info: { mint: opts.mint ?? MINT, authority: 'OwnerWallet111', tokenAmount: { amount: opts.amount, decimals: 6 } } },
          },
          { program: 'spl-memo', parsed: opts.memo },
        ],
      },
    },
  };
}

describe('base58', () => {
  it('round-trips bytes, including leading zeros', () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 250, 255]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });

  it('recognises a real Solana address', () => {
    expect(isWalletAddress(MINT)).toBe(true);
    expect(isWalletAddress('not-a-wallet')).toBe(false);
  });
});

describe('verifyWalletSignature', () => {
  it('accepts the wallet signature over the exact message and nothing else', () => {
    const wallet = makeWallet();
    const sig = wallet.sign('hello arena');
    expect(verifyWalletSignature(wallet.address, 'hello arena', sig)).toBe(true);
    expect(verifyWalletSignature(wallet.address, 'hello arena!', sig)).toBe(false);
    expect(verifyWalletSignature(makeWallet().address, 'hello arena', sig)).toBe(false);
  });
});

describe('verifyBurn', () => {
  it('reads the burned amount, owner and memo', async () => {
    const burn = await verifyBurn(rpcReturning(burnTx({ amount: '50000000000', memo: 'AICOLOSSEUM:WARDEN:blackout' })), 'sig', MINT, 6);
    expect(burn).toMatchObject({ owner: 'OwnerWallet111', amount: 50000, memo: 'AICOLOSSEUM:WARDEN:blackout' });
  });

  it('rejects failed transactions, other mints and stale burns', async () => {
    await expect(verifyBurn(rpcReturning(burnTx({ amount: '1', memo: '', err: { InstructionError: [] } })), 's', MINT, 6)).rejects.toThrow(/failed/);
    await expect(verifyBurn(rpcReturning(burnTx({ amount: '1000000', memo: '', mint: 'Other' })), 's', MINT, 6)).rejects.toThrow(/No burn/);
    const old = Math.floor(Date.now() / 1000) - 7200;
    await expect(verifyBurn(rpcReturning(burnTx({ amount: '1000000', memo: '', blockTime: old })), 's', MINT, 6)).rejects.toThrow(/too old/);
  });

  it('gives up politely when the transaction never confirms', async () => {
    await expect(verifyBurn(rpcReturning(null), 's', MINT, 6, { attempts: 2, delayMs: 1 })).rejects.toThrow(/not confirmed/);
  });
});
