import { describe, expect, it } from 'vitest';
import {
  IntegrationEventLike,
  InvalidOutboxMessageError,
  OutboxMessage,
  OutboxMessageAlreadyPublishedError,
  OutboxMessageState,
} from './outbox-message.js';

const occurredAt = new Date('2026-11-15T10:00:00.000Z');

function createEvent(
  overrides: Partial<IntegrationEventLike> = {},
): IntegrationEventLike {
  return {
    eventId: 'event-123',
    aggregateId: 'wallet-123',
    eventType: 'WalletBalanceChanged',
    occurredAt,
    toJSON: () => ({
      eventId: 'event-123',
      eventType: 'WalletBalanceChanged',
      aggregateId: 'wallet-123',
      occurredAt: occurredAt.toISOString(),
      version: 1,
      data: {
        walletId: 'wallet-123',
        balance: {
          amount: '100.00',
          currency: 'BRL',
        },
      },
    }),
    ...overrides,
  };
}

function createState(
  overrides: Partial<OutboxMessageState> = {},
): OutboxMessageState {
  return {
    id: 'event-123',
    aggregateId: 'wallet-123',
    eventType: 'WalletBalanceChanged',
    payload: {
      eventId: 'event-123',
      eventType: 'WalletBalanceChanged',
    },
    occurredAt,
    attempts: 0,
    ...overrides,
  };
}

describe('OutboxMessage', () => {
  describe('enqueue', () => {
    it('creates a pending message from an integration event', () => {
      const message = OutboxMessage.enqueue(createEvent());

      expect(message.id).toBe('event-123');
      expect(message.aggregateId).toBe('wallet-123');
      expect(message.eventType).toBe('WalletBalanceChanged');
      expect(message.attempts).toBe(0);
      expect(message.isPending()).toBe(true);
      expect(message.publishedAt).toBeUndefined();
      expect(message.nextAttemptAt).toBeUndefined();
    });

    it('stores the serialized event as payload', () => {
      const event = createEvent();
      const message = OutboxMessage.enqueue(event);

      expect(message.payload).toEqual(event.toJSON());
    });

    it.each([
      ['eventId', { eventId: '' }],
      ['aggregateId', { aggregateId: '' }],
      ['eventType', { eventType: '' }],
    ])('rejects an empty %s', (_field: string, overrides: Partial<IntegrationEventLike>) => {
      expect(() =>
        OutboxMessage.enqueue(createEvent(overrides)),
      ).toThrow(InvalidOutboxMessageError);
    });

    it('rejects an invalid occurredAt', () => {
      expect(() =>
        OutboxMessage.enqueue(
          createEvent({ occurredAt: new Date('invalid') }),
        ),
      ).toThrow(InvalidOutboxMessageError);
    });

    it('rejects a non-serializable payload', () => {
      const event = createEvent({
        toJSON: () => ({ amount: 10n }),
      });

      expect(() => OutboxMessage.enqueue(event)).toThrow(
        InvalidOutboxMessageError,
      );
    });

    it('does not retain mutable references to the original payload', () => {
      const data = {
        balance: {
          amount: '100.00',
          currency: 'BRL',
        },
      };

      const event = createEvent({
        toJSON: () => ({ data }),
      });

      const message = OutboxMessage.enqueue(event);

      data.balance.amount = '500.00';

      expect(
        (message.payload.data as typeof data).balance.amount,
      ).toBe('100.00');
    });
  });

  describe('publication state', () => {
    it('starts as pending and due immediately', () => {
      const message = OutboxMessage.enqueue(createEvent());

      expect(message.isPending()).toBe(true);
      expect(message.isDue(occurredAt)).toBe(true);
    });

    it('marks a message as published', () => {
      const message = OutboxMessage.enqueue(createEvent());
      const publishedAt = new Date('2026-11-15T10:01:00.000Z');

      message.markPublished(publishedAt);

      expect(message.isPending()).toBe(false);
      expect(message.isDue(publishedAt)).toBe(false);
      expect(message.publishedAt).toEqual(publishedAt);
      expect(message.nextAttemptAt).toBeUndefined();
    });

    it('does not allow publishing the same message twice', () => {
      const message = OutboxMessage.enqueue(createEvent());

      message.markPublished(occurredAt);

      expect(() => message.markPublished(occurredAt)).toThrow(
        OutboxMessageAlreadyPublishedError,
      );
    });

    it('rejects an invalid publication date', () => {
      const message = OutboxMessage.enqueue(createEvent());

      expect(() =>
        message.markPublished(new Date('invalid')),
      ).toThrow(InvalidOutboxMessageError);
    });
  });

  describe('retry scheduling', () => {
    it('increments attempts and schedules the first retry after one second', () => {
      const message = OutboxMessage.enqueue(createEvent());

      message.scheduleRetry(occurredAt);

      expect(message.attempts).toBe(1);
      expect(message.nextAttemptAt).toEqual(
        new Date(occurredAt.getTime() + 1_000),
      );
      expect(message.isDue(occurredAt)).toBe(false);
      expect(message.isDue(
        new Date(occurredAt.getTime() + 1_000),
      )).toBe(true);
    });

    it('doubles the delay on each retry', () => {
      const message = OutboxMessage.enqueue(createEvent());

      message.scheduleRetry(occurredAt);
      message.scheduleRetry(occurredAt);

      expect(message.attempts).toBe(2);
      expect(message.nextAttemptAt).toEqual(
        new Date(occurredAt.getTime() + 2_000),
      );
    });

    it('caps the retry delay at one hour', () => {
      const message = OutboxMessage.enqueue(createEvent());

      for (let attempt = 0; attempt < 20; attempt += 1) {
        message.scheduleRetry(occurredAt);
      }

      expect(message.attempts).toBe(20);
      expect(message.nextAttemptAt).toEqual(
        new Date(occurredAt.getTime() + 60 * 60 * 1_000),
      );
    });

    it('does not allow retrying a published message', () => {
      const message = OutboxMessage.enqueue(createEvent());

      message.markPublished(occurredAt);

      expect(() => message.scheduleRetry(occurredAt)).toThrow(
        OutboxMessageAlreadyPublishedError,
      );
    });

    it('rejects an invalid retry date', () => {
      const message = OutboxMessage.enqueue(createEvent());

      expect(() =>
        message.scheduleRetry(new Date('invalid')),
      ).toThrow(InvalidOutboxMessageError);
    });
  });

  describe('rehydrate', () => {
    it('restores an unpublished message', () => {
      const message = OutboxMessage.rehydrate(createState());

      expect(message.id).toBe('event-123');
      expect(message.isPending()).toBe(true);
      expect(message.attempts).toBe(0);
    });

    it('restores a message with a scheduled retry', () => {
      const nextAttemptAt = new Date('2026-11-15T10:00:01.000Z');

      const message = OutboxMessage.rehydrate(
        createState({
          attempts: 1,
          nextAttemptAt,
        }),
      );

      expect(message.attempts).toBe(1);
      expect(message.nextAttemptAt).toEqual(nextAttemptAt);
      expect(message.isDue(occurredAt)).toBe(false);
    });

    it('restores a published message', () => {
      const publishedAt = new Date('2026-11-15T10:05:00.000Z');

      const message = OutboxMessage.rehydrate(
        createState({ publishedAt }),
      );

      expect(message.isPending()).toBe(false);
      expect(message.publishedAt).toEqual(publishedAt);
    });

    it('rejects negative attempts', () => {
      expect(() =>
        OutboxMessage.rehydrate(createState({ attempts: -1 })),
      ).toThrow(InvalidOutboxMessageError);
    });

    it('rejects non-integer attempts', () => {
      expect(() =>
        OutboxMessage.rehydrate(createState({ attempts: 1.5 })),
      ).toThrow(InvalidOutboxMessageError);
    });

    it('rejects a published message with a scheduled retry', () => {
      expect(() =>
        OutboxMessage.rehydrate(
          createState({
            publishedAt: occurredAt,
            nextAttemptAt: occurredAt,
          }),
        ),
      ).toThrow(InvalidOutboxMessageError);
    });
  });

  describe('date immutability', () => {
    it('does not expose its internal occurredAt date', () => {
      const inputDate = new Date(occurredAt);
      const message = OutboxMessage.enqueue(
        createEvent({ occurredAt: inputDate }),
      );

      inputDate.setFullYear(2030);

      const exposedDate = message.occurredAt;
      exposedDate.setFullYear(2040);

      expect(message.occurredAt).toEqual(occurredAt);
    });

    it('does not expose its internal retry date', () => {
      const message = OutboxMessage.enqueue(createEvent());
      message.scheduleRetry(occurredAt);

      const exposedDate = message.nextAttemptAt!;
      exposedDate.setFullYear(2040);

      expect(message.nextAttemptAt).toEqual(
        new Date(occurredAt.getTime() + 1_000),
      );
    });
  });
});
