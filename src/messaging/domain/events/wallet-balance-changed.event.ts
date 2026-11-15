import {
  IntegrationEvent,
  type EventContext,
  type IntegrationEventProps,
  type MoneyProps,
} from '../integration-event.js';
import type {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../../wallet/domain/wallet-ledger-entry.js';
import type {
  Wallet,
} from '../../../wallet/domain/wallet.js';

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor(
    props: IntegrationEventProps<WalletBalanceChangedData>,
  ) {
    super(props);
  }

  static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    ctx: EventContext,
  ): WalletBalanceChanged {
    const toMoneyProps = (money: {
      toDecimalString(): string;
      currency: string;
    }): MoneyProps => ({
      amount: money.toDecimalString(),
      currency: money.currency,
    });

    if (entry.balanceBefore.equals(entry.balanceAfter)) {
      throw new Error(
        'WalletBalanceChanged requires an actual balance change.',
      );
    }

    return new WalletBalanceChanged({
      aggregateId: entry.walletId,
      correlationId: ctx.correlationId,
      eventId: ctx.eventId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt ?? entry.createdAt,
      data: {
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: toMoneyProps(entry.money),
        balanceBefore: toMoneyProps(entry.balanceBefore),
        balanceAfter: toMoneyProps(entry.balanceAfter),
        walletVersion: wallet.version,
      },
    });
  }
}
