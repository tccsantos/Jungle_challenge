import { describe, expect, it } from 'vitest';

import {
  createWagerPayloadHash,
  type WagerPayload,
} from './wager-payload-hash.js';

describe('createWagerPayloadHash', () => {
  const payload: WagerPayload = {
    providerId: 'provider-a',
    externalTransactionId: 'bet-123',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: {
      amount: '25.00',
      currency: 'BRL',
    },
  };

  it('generates the same hash for identical payloads', () => {
    expect(createWagerPayloadHash(payload)).toBe(
      createWagerPayloadHash({ ...payload }),
    );
  });

  it('does not depend on input property order', () => {
    const reordered: WagerPayload = {
      money: {
        currency: 'BRL',
        amount: '25.00',
      },
      kind: 'BET',
      gameId: 'game-1',
      roundId: 'round-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      externalTransactionId: 'bet-123',
      providerId: 'provider-a',
    };

    expect(createWagerPayloadHash(reordered)).toBe(
      createWagerPayloadHash(payload),
    );
  });

  it('detects a changed monetary amount', () => {
    const changed: WagerPayload = {
      ...payload,
      money: {
        amount: '30.00',
        currency: 'BRL',
      },
    };

    expect(createWagerPayloadHash(changed)).not.toBe(
      createWagerPayloadHash(payload),
    );
  });

  it('detects a changed transaction kind', () => {
    expect(
      createWagerPayloadHash({
        ...payload,
        kind: 'WIN',
      }),
    ).not.toBe(createWagerPayloadHash(payload));
  });
});
