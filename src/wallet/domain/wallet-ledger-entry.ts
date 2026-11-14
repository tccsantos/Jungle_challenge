import { randomUUID } from 'node:crypto';
import { Money } from '../../shared/domain/money.js';

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export interface CreateLedgerEntryProps {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

export interface LedgerEntryState extends CreateLedgerEntryProps {
  id: string;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private readonly createdAtTimestamp: number;

  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    createdAt: Date,
  ) {
    this.createdAtTimestamp = createdAt.getTime();
  }

  get createdAt(): Date {
    return new Date(this.createdAtTimestamp);
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.walletId || !props.transactionId) {
      throw new Error('Wallet ID and transaction ID are required');
    }

    if (
      props.direction !== LedgerDirection.Debit &&
      props.direction !== LedgerDirection.Credit
    ) {
      throw new Error('Invalid ledger direction');
    }

    if (props.money.isNegative() || props.money.isZero()) {
      throw new Error('Ledger amount must be greater than zero');
    }

    const expectedBalance =
      props.direction === LedgerDirection.Debit
        ? props.balanceBefore.subtract(props.money)
        : props.balanceBefore.add(props.money);

    if (expectedBalance.isNegative()) {
      throw new Error('Ledger entry cannot produce a negative balance');
    }

    const entry = new WalletLedgerEntry(
      randomUUID(),
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      new Date(),
    );

    if (!entry.isBalanced()) {
      throw new Error('Ledger entry is not balanced');
    }

    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  isBalanced(): boolean {
    try {
      const expectedBalance =
        this.direction === LedgerDirection.Debit
          ? this.balanceBefore.subtract(this.money)
          : this.balanceBefore.add(this.money);

      return (
        !this.money.isNegative() &&
        !this.money.isZero() &&
        !expectedBalance.isNegative() &&
        expectedBalance.equals(this.balanceAfter)
      );
    } catch {
      return false;
    }
  }
}
