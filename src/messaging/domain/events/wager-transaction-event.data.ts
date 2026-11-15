import type { MoneyProps } from '../integration-event.js';
import type {
  WagerTransactionKind,
} from '../../../wagering/domain/wager-transaction.js';

export interface WagerTransactionEventData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}
