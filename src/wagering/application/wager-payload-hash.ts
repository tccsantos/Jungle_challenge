import { createHash } from 'node:crypto';

export interface WagerPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: {
    amount: string;
    currency: string;
  };
  referenceExternalTransactionId?: string;
}

export function createWagerPayloadHash(
  payload: WagerPayload,
): string {
  const canonicalPayload = {
    externalTransactionId: payload.externalTransactionId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: {
      amount: payload.money.amount,
      currency: payload.money.currency,
    },
    playerId: payload.playerId,
    providerId: payload.providerId,
    referenceExternalTransactionId:
      payload.referenceExternalTransactionId ?? null,
    roundId: payload.roundId,
    walletId: payload.walletId,
  };

  return createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
}
