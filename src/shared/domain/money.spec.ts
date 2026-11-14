import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  it('should create a monetary value', () => {
    const money = Money.fromDecimal('150.50', 'BRL');

    expect(money.toDecimalString()).toBe('150.50');
    expect(money.currency).toBe('BRL');
  });

  it('should add monetary values', () => {
    const result = Money.fromDecimal('10.50', 'BRL')
      .add(Money.fromDecimal('5.25', 'BRL'));

    expect(result.toDecimalString()).toBe('15.75');
  });

  it('should subtract monetary values', () => {
    const result = Money.fromDecimal('20.00', 'BRL')
      .subtract(Money.fromDecimal('7.50', 'BRL'));

    expect(result.toDecimalString()).toBe('12.50');
  });

  it('should reject invalid decimal values', () => {
    expect(() => Money.fromDecimal('10.999', 'BRL')).toThrow();
    expect(() => Money.fromDecimal('abc', 'BRL')).toThrow();
  });

  it('should reject operations with different currencies', () => {
    const brl = Money.fromDecimal('10.00', 'BRL');
    const usd = Money.fromDecimal('10.00', 'USD');

    expect(() => brl.add(usd)).toThrow();
  });

  it('should preserve negative values', () => {
    const money = Money.fromDecimal('-10.50', 'BRL');

    expect(money.isNegative()).toBe(true);
    expect(money.toDecimalString()).toBe('-10.50');
  });
});
