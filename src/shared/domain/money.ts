export class Money {
  private constructor(
    private readonly cents: bigint,
    public readonly currency: string,
  ) {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Invalid currency. Use a 3-letter uppercase code.');
    }
  }

  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  static fromDecimal(value: string, currency: string): Money {
    const normalized = value.trim();
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);

    if (!match) {
      throw new Error(`Invalid monetary value: ${value}`);
    }

    const [, sign, integerPart, decimalPart = ''] = match;

    const cents =
      BigInt(integerPart) * 100n +
      BigInt(decimalPart.padEnd(2, '0'));

    return new Money(sign === '-' ? -cents : cents, currency);
  }

  add(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  isGreaterThan(other: Money): boolean {
    this.ensureSameCurrency(other);
    return this.cents > other.cents;
  }

  equals(other: Money): boolean {
    this.ensureSameCurrency(other);
    return this.cents === other.cents;
  }

  toDecimalString(): string {
    const negative = this.cents < 0n;
    const absolute = negative ? -this.cents : this.cents;

    const integerPart = absolute / 100n;
    const decimalPart = (absolute % 100n)
      .toString()
      .padStart(2, '0');

    return `${negative ? '-' : ''}${integerPart}.${decimalPart}`;
  }

  private ensureSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: ${this.currency} and ${other.currency}`,
      );
    }
  }
}
