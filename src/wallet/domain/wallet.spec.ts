import { describe, expect, it } from 'vitest';
import { Money } from '../../shared/domain/money.js';
import {
  InsufficientFundsError,
  Wallet,
} from './wallet.js';

describe('Wallet', () => {
  const createWallet = (balance = '100.00') =>
    Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.fromDecimal(balance, 'BRL'),
    });

  it('should open with version 1', () => {
    const wallet = createWallet();

    expect(wallet.balance.toDecimalString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('should debit successfully', () => {
    const wallet = createWallet();

    const result = wallet.debit(
      Money.fromDecimal('30.00', 'BRL'),
    );

    expect(result.balanceBefore.toDecimalString()).toBe('100.00');
    expect(result.balanceAfter.toDecimalString()).toBe('70.00');
    expect(wallet.balance.toDecimalString()).toBe('70.00');
    expect(wallet.version).toBe(2);
  });

  it('should credit successfully', () => {
    const wallet = createWallet();

    wallet.credit(Money.fromDecimal('50.00', 'BRL'));

    expect(wallet.balance.toDecimalString()).toBe('150.00');
    expect(wallet.version).toBe(2);
  });

  it('should reject debit with insufficient funds', () => {
    const wallet = createWallet('20.00');

    expect(() =>
      wallet.debit(Money.fromDecimal('30.00', 'BRL')),
    ).toThrow(InsufficientFundsError);

    expect(wallet.balance.toDecimalString()).toBe('20.00');
    expect(wallet.version).toBe(1);
  });

  it('should reject a different currency', () => {
    const wallet = createWallet();

    expect(() =>
      wallet.debit(Money.fromDecimal('10.00', 'USD')),
    ).toThrow('Currency mismatch');
  });

  it('should reject zero and negative amounts', () => {
    const wallet = createWallet();

    expect(() =>
      wallet.debit(Money.zero('BRL')),
    ).toThrow('Amount must be greater than zero');

    expect(() =>
      wallet.credit(Money.fromDecimal('-10.00', 'BRL')),
    ).toThrow('Amount must be greater than zero');
  });

  it('should reject a negative initial balance', () => {
    expect(() =>
      createWallet('-10.00'),
    ).toThrow('Initial balance cannot be negative');
  });
});
