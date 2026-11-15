import { describe, expect, it } from 'vitest';

import {
  type IntegrationEventProps,
} from '../integration-event.js';

import {
  WagerTransactionProcessed,
} from './wager-transaction-processed.event.js';

import {
  WagerTransactionRejected,
} from './wager-transaction-rejected.event.js';

import {
  WagerTransactionPendingReference,
} from './wager-transaction-pending-reference.event.js';

import {
  WalletBalanceChanged,
  type WalletBalanceChangedData,
} from './wallet-balance-changed.event.js';

import type {
  WagerTransactionEventData,
} from './wager-transaction-event.data.js';

import type {
  FailureCode,
  WagerTransactionKind,
} from '../../../wagering/domain/wager-transaction.js';

import {
  LedgerDirection,
} from '../../../wallet/domain/wallet-ledger-entry.js';

const occurredAt = new Date('2026-11-15T12:00:00.000Z');

const baseData: WagerTransactionEventData = {
  transactionId: 'transaction-123',
  providerId: 'provider-a',
  externalTransactionId: 'external-123',
  walletId: 'wallet-123',
  playerId: 'player-123',
  roundId: 'round-123',
  gameId: 'game-123',
  kind: 'BET' as WagerTransactionKind,
  money: {
    amount: '25.00',
    currency: 'BRL',
  },
};

const baseProps = {
  eventId: 'event-123',
  aggregateId: 'wallet-123',
  correlationId: 'correlation-123',
  occurredAt,
  data: baseData,
};

describe('IntegrationEvent', () => {
  it('should create an event with the provided envelope', () => {
    const event = new WagerTransactionProcessed(baseProps);

    expect(event.eventId).toBe('event-123');
    expect(event.aggregateId).toBe('wallet-123');
    expect(event.correlationId).toBe('correlation-123');
    expect(event.occurredAt).toEqual(occurredAt);
    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.version).toBe(1);
  });

  it('should serialize the complete envelope', () => {
    const event = new WagerTransactionProcessed(baseProps);

    expect(event.toJSON()).toEqual({
      eventId: 'event-123',
      eventType: 'WagerTransactionProcessed',
      aggregateId: 'wallet-123',
      correlationId: 'correlation-123',
      occurredAt: occurredAt.toISOString(),
      version: 1,
      data: baseData,
    });
  });

  it('should include causationId when provided', () => {
    const event = new WagerTransactionProcessed({
      ...baseProps,
      causationId: 'causation-123',
    });

    expect(event.toJSON().causationId).toBe('causation-123');
  });

  it('should reject empty envelope identifiers', () => {
    expect(
      () =>
        new WagerTransactionProcessed({
          ...baseProps,
          eventId: ' ',
        }),
    ).toThrow();

    expect(
      () =>
        new WagerTransactionProcessed({
          ...baseProps,
          aggregateId: ' ',
        }),
    ).toThrow();

    expect(
      () =>
        new WagerTransactionProcessed({
          ...baseProps,
          correlationId: ' ',
        }),
    ).toThrow();
  });

  it('should reject an invalid occurrence date', () => {
    expect(
      () =>
        new WagerTransactionProcessed({
          ...baseProps,
          occurredAt: new Date('invalid'),
        }),
    ).toThrow();
  });

  it('should keep event data immutable', () => {
    const input = {
      ...baseData,
      money: { ...baseData.money },
    };

    const event = new WagerTransactionProcessed({
      ...baseProps,
      data: input,
    });

    input.money.amount = '999.99';

    expect(event.data.money.amount).toBe('25.00');
    expect(Object.isFrozen(event.data)).toBe(true);
    expect(Object.isFrozen(event.data.money)).toBe(true);
  });

  it('should return an independent serialized data object', () => {
    const event = new WagerTransactionProcessed(baseProps);

    const serialized = event.toJSON();
    serialized.data.money.amount = '999.99';

    expect(event.data.money.amount).toBe('25.00');
  });
});

describe('WagerTransactionProcessed', () => {
  it('should identify the processed event', () => {
    const event = new WagerTransactionProcessed(baseProps);

    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.version).toBe(1);
  });
});

describe('WagerTransactionRejected', () => {
  it('should include the failure code', () => {
    const event = new WagerTransactionRejected({
      ...baseProps,
      data: {
        ...baseData,
        failureCode: 'INSUFFICIENT_FUNDS' as FailureCode,
      },
    });

    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.data.failureCode).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('WagerTransactionPendingReference', () => {
  it('should include the missing reference identifier', () => {
    const event = new WagerTransactionPendingReference({
      ...baseProps,
      data: {
        ...baseData,
        referenceExternalTransactionId: 'reference-123',
      },
    });

    expect(event.eventType).toBe(
      'WagerTransactionPendingReference',
    );
    expect(event.data.referenceExternalTransactionId).toBe(
      'reference-123',
    );
  });
});

describe('WalletBalanceChanged', () => {
  it('should serialize the wallet balance change', () => {
    const data: WalletBalanceChangedData = {
      walletId: 'wallet-123',
      transactionId: 'transaction-123',
      direction: LedgerDirection.Debit,
      money: {
        amount: '25.00',
        currency: 'BRL',
      },
      balanceBefore: {
        amount: '100.00',
        currency: 'BRL',
      },
      balanceAfter: {
        amount: '75.00',
        currency: 'BRL',
      },
      walletVersion: 2,
    };

    const props: IntegrationEventProps<WalletBalanceChangedData> = {
      ...baseProps,
      data,
    };

    const event = new WalletBalanceChanged(props);

    expect(event.eventType).toBe('WalletBalanceChanged');
    expect(event.version).toBe(1);
    expect(event.data.balanceBefore.amount).toBe('100.00');
    expect(event.data.balanceAfter.amount).toBe('75.00');
    expect(event.data.walletVersion).toBe(2);
  });
});
