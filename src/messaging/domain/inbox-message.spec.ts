import { describe, expect, it } from 'vitest';

import {
  InboxMessage,
  InboxMessageAlreadyProcessedError,
  InvalidInboxMessageError,
  ReceiveInboxProps
} from './inbox-message.js';

describe('InboxMessage', () => {
  const baseProps = {
    messageId: 'message-123',
    consumerName: 'wager-processor',
    payloadHash: 'a'.repeat(64),
  };

  describe('receive', () => {
    it('should create an unprocessed inbox message', () => {
      const message = InboxMessage.receive(baseProps);

      expect(message.messageId).toBe(baseProps.messageId);
      expect(message.consumerName).toBe(baseProps.consumerName);
      expect(message.payloadHash).toBe(baseProps.payloadHash);
      expect(message.isProcessed()).toBe(false);
      expect(message.processedAt).toBeUndefined();
    });

    it('should use the provided receivedAt date', () => {
      const receivedAt = new Date('2026-11-15T10:00:00Z');

      const message = InboxMessage.receive({
        ...baseProps,
        receivedAt,
      });

      expect(message.receivedAt).toEqual(receivedAt);
    });

    it.each([
      ['messageId', { ...baseProps, messageId: '' }],
      ['consumerName', { ...baseProps, consumerName: '' }],
      ['payloadHash', { ...baseProps, payloadHash: '' }],
    ])('should reject an empty %s', (_: string, props: ReceiveInboxProps) => {
      expect(() => InboxMessage.receive(props))
        .toThrow(InvalidInboxMessageError);
    });

    it('should reject an invalid receivedAt date', () => {
      expect(() =>
        InboxMessage.receive({
          ...baseProps,
          receivedAt: new Date('invalid'),
        }),
      ).toThrow(InvalidInboxMessageError);
    });
  });

  describe('markProcessed', () => {
    it('should mark the message as processed', () => {
      const message = InboxMessage.receive(baseProps);
      const processedAt = new Date('2026-11-15T10:05:00Z');

      message.markProcessed(processedAt);

      expect(message.isProcessed()).toBe(true);
      expect(message.processedAt).toEqual(processedAt);
    });

    it('should not allow processing the message twice', () => {
      const message = InboxMessage.receive(baseProps);

      message.markProcessed(new Date());

      expect(() => message.markProcessed(new Date()))
        .toThrow(InboxMessageAlreadyProcessedError);
    });

    it('should reject an invalid processedAt date', () => {
      const message = InboxMessage.receive(baseProps);

      expect(() => message.markProcessed(new Date('invalid')))
        .toThrow(InvalidInboxMessageError);
    });
  });

  describe('rehydrate', () => {
    it('should restore an unprocessed message', () => {
      const receivedAt = new Date('2026-11-15T10:00:00Z');

      const message = InboxMessage.rehydrate({
        ...baseProps,
        receivedAt,
      });

      expect(message.isProcessed()).toBe(false);
      expect(message.receivedAt).toEqual(receivedAt);
    });

    it('should restore a processed message', () => {
      const receivedAt = new Date('2026-11-15T10:00:00Z');
      const processedAt = new Date('2026-11-15T10:05:00Z');

      const message = InboxMessage.rehydrate({
        ...baseProps,
        receivedAt,
        processedAt,
      });

      expect(message.isProcessed()).toBe(true);
      expect(message.processedAt).toEqual(processedAt);
    });
  });

  describe('date immutability', () => {
    it('should not expose the internal receivedAt date', () => {
      const message = InboxMessage.receive(baseProps);
      const originalDate = message.receivedAt;

      originalDate.setFullYear(2000);

      expect(message.receivedAt.getFullYear())
        .not.toBe(2000);
    });

    it('should not expose the internal processedAt date', () => {
      const message = InboxMessage.receive(baseProps);
      const processedAt = new Date('2026-11-15T10:05:00Z');

      message.markProcessed(processedAt);

      const exposedDate = message.processedAt!;
      exposedDate.setFullYear(2000);

      expect(message.processedAt).toEqual(processedAt);
    });
  });
});
