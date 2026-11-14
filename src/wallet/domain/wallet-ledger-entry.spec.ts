import { describe, expect, it } from 'vitest';
import { Money } from '../../shared/domain/money.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from './wallet-ledger-entry.js';

describe('WalletLedgerEntry', () => {
  const baseProps = {
    walletId: 'wallet-1',
    transactionId: 'transaction-1',
    direction: LedgerDirection.Debit,
    money: Money.fromDecimal('25.00', 'BRL'),
    balanceBefore: Money.fromDecimal('100.00', 'BRL'),
    balanceAfter: Money.fromDecimal('75.00', 'BRL'),
  };

  it('should create a valid debit entry', () => {
    const entry = WalletLedgerEntry.create(baseProps);

    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.toDecimalString()).toBe('100.00');
    expect(entry.balanceAfter.toDecimalString()).toBe('75.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('should create a valid credit entry', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps,
      direction: LedgerDirection.Credit,
      balanceBefore: Money.fromDecimal('100.00', 'BRL'),
      balanceAfter: Money.fromDecimal('125.00', 'BRL'),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it('should reject an incorrect balance calculation', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps,
        balanceAfter: Money.fromDecimal('80.00', 'BRL'),
      }),
    ).toThrow('Ledger entry is not balanced');
  });

  it('should reject zero amounts', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps,
        money: Money.zero('BRL'),
      }),
    ).toThrow('Ledger amount must be greater than zero');
  });

  it('should reject negative resulting balances', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps,
        money: Money.fromDecimal('150.00', 'BRL'),
        balanceAfter: Money.fromDecimal('-50.00', 'BRL'),
      }),
    ).toThrow('Ledger entry cannot produce a negative balance');
  });

  it('should generate a unique ID', () => {
    const first = WalletLedgerEntry.create(baseProps);
    const second = WalletLedgerEntry.create(baseProps);

    expect(first.id).not.toBe(second.id);
  });

  it('should protect its creation date', () => {
    const entry = WalletLedgerEntry.create(baseProps);
    const date = entry.createdAt;

    date.setFullYear(2000);

    expect(entry.createdAt.getFullYear()).not.toBe(2000);
  });
});
