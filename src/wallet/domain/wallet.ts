import { Money } from '../../shared/domain/money.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BalanceChange {
  balanceBefore: Money;
  balanceAfter: Money;
}

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient funds');
    this.name = 'InsufficientFundsError';
  }
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): Wallet {
    if (!props.playerId.trim()) {
      throw new Error('Player ID is required');
    }

    if (props.initialBalance.isNegative()) {
      throw new Error('Initial balance cannot be negative');
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      new Date(),
      new Date(),
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(money: Money): BalanceChange {
    this.assertValidAmount(money);

    if (money.isGreaterThan(this._balance)) {
      throw new InsufficientFundsError();
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.subtract(money);

    this.applyBalanceChange(balanceAfter);

    return { balanceBefore, balanceAfter };
  }

  credit(money: Money): BalanceChange {
    this.assertValidAmount(money);

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(money);

    this.applyBalanceChange(balanceAfter);

    return { balanceBefore, balanceAfter };
  }

  private assertValidAmount(money: Money): void {
    if (money.currency !== this.currency) {
      throw new Error('Currency mismatch');
    }

    if (money.isNegative() || money.isZero()) {
      throw new Error('Amount must be greater than zero');
    }
  }

  private applyBalanceChange(balance: Money): void {
    this._balance = balance;
    this._version++;
    this._updatedAt = new Date();
  }
}
