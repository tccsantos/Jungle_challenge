import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  OutboxMessage,
} from '../domain/outbox-message.js';
import {
  OutboxRepository,
} from '../repositories/outbox.repository.js';
import {
  SqsService,
} from '../infrastructure/sqs.service.js';

import {
  PublishOutboxUseCase,
} from './publish-outbox.use-case.js';

describe('PublishOutboxUseCase', () => {
  const QUEUE_URL = 'http://localstack:4566/test-events.fifo';

  const originalQueueUrl =
    process.env.SQS_EVENTS_QUEUE_URL;

  const EVENT_ID =
    '11111111-1111-4111-8111-111111111111';

  const WALLET_ID =
    '22222222-2222-4222-8222-222222222222';

  let repository: OutboxRepository;
  let sqs: SqsService;
  let useCase: PublishOutboxUseCase;

  let claimPending: ReturnType<typeof vi.fn>;
  let confirmPublished: ReturnType<typeof vi.fn>;
  let schedulePublishRetry: ReturnType<typeof vi.fn>;
  let sendFifo: ReturnType<typeof vi.fn>;

  function createMessage(): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: EVENT_ID,
      aggregateId: WALLET_ID,
      eventType: 'WagerTransactionProcessed',
      payload: {
        eventId: EVENT_ID,
        eventType: 'WagerTransactionProcessed',
        aggregateId: WALLET_ID,
        version: 1,
        data: {
          transactionId:
            '33333333-3333-4333-8333-333333333333',
        },
      },
      occurredAt: new Date('2026-11-16T07:00:00Z'),
      attempts: 0,
    });
  }

  function createClaimedMessage() {
    return {
      message: createMessage(),
      leaseToken:
        '44444444-4444-4444-8444-444444444444',
    };
  }

  beforeEach(() => {
    process.env.SQS_EVENTS_QUEUE_URL = QUEUE_URL;

    claimPending = vi.fn().mockResolvedValue([]);
    confirmPublished = vi.fn().mockResolvedValue(true);
    schedulePublishRetry = vi.fn().mockResolvedValue(true);
    sendFifo = vi.fn().mockResolvedValue('sqs-message-id');

    repository = {
      claimPending,
      confirmPublished,
      schedulePublishRetry,
    } as unknown as OutboxRepository;

    sqs = {
      sendFifo,
    } as unknown as SqsService;

    useCase = new PublishOutboxUseCase(
      repository,
      sqs,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalQueueUrl === undefined) {
      delete process.env.SQS_EVENTS_QUEUE_URL;
    } else {
      process.env.SQS_EVENTS_QUEUE_URL =
        originalQueueUrl;
    }
  });

  it('publishes an event and confirms it in the outbox', async () => {
    const claimed = createClaimedMessage();

    claimPending.mockResolvedValue([claimed]);

    const result = await useCase.execute();

    expect(result).toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
      lostLease: 0,
    });

    expect(sendFifo).toHaveBeenCalledExactlyOnceWith({
      queueUrl: QUEUE_URL,
      body: { ...claimed.message.payload },
      groupId: WALLET_ID,
      deduplicationId: EVENT_ID,
    });

    expect(confirmPublished).toHaveBeenCalledWith(
      claimed,
    );

    expect(schedulePublishRetry).not.toHaveBeenCalled();
  });

  it('schedules retry when SQS publishing fails', async () => {
    const claimed = createClaimedMessage();

    claimPending.mockResolvedValue([claimed]);

    sendFifo.mockRejectedValue(
      new Error('SQS unavailable'),
    );

    const result = await useCase.execute();

    expect(result).toEqual({
      claimed: 1,
      published: 0,
      failed: 1,
      lostLease: 0,
    });

    expect(confirmPublished).not.toHaveBeenCalled();

    expect(schedulePublishRetry).toHaveBeenCalledWith(
      claimed,
    );
  });

  it('detects when the publication lease was lost', async () => {
    const claimed = createClaimedMessage();

    claimPending.mockResolvedValue([claimed]);
    confirmPublished.mockResolvedValue(false);

    const result = await useCase.execute();

    expect(result).toEqual({
      claimed: 1,
      published: 0,
      failed: 0,
      lostLease: 1,
    });

    expect(sendFifo).toHaveBeenCalledTimes(1);
    expect(schedulePublishRetry).not.toHaveBeenCalled();
  });

  it('schedules retry if confirmation fails after SQS accepts the message', async () => {
    const claimed = createClaimedMessage();

    claimPending.mockResolvedValue([claimed]);

    confirmPublished.mockRejectedValue(
      new Error('Database unavailable'),
    );

    const result = await useCase.execute();

    expect(result).toEqual({
      claimed: 1,
      published: 0,
      failed: 1,
      lostLease: 0,
    });

    expect(sendFifo).toHaveBeenCalledTimes(1);
    expect(schedulePublishRetry).toHaveBeenCalledWith(
      claimed,
    );
  });

  it('reports lost lease when retry scheduling is not authorized', async () => {
    const claimed = createClaimedMessage();

    claimPending.mockResolvedValue([claimed]);

    sendFifo.mockRejectedValue(
      new Error('SQS unavailable'),
    );

    schedulePublishRetry.mockResolvedValue(false);

    const result = await useCase.execute();

    expect(result.failed).toBe(1);
    expect(result.lostLease).toBe(1);
    expect(result.published).toBe(0);
  });

  it('does not publish anything when the outbox is empty', async () => {
    const result = await useCase.execute();

    expect(result).toEqual({
      claimed: 0,
      published: 0,
      failed: 0,
      lostLease: 0,
    });

    expect(sendFifo).not.toHaveBeenCalled();
    expect(confirmPublished).not.toHaveBeenCalled();
    expect(schedulePublishRetry).not.toHaveBeenCalled();
  });

  it('rejects execution without the events queue URL', async () => {
    delete process.env.SQS_EVENTS_QUEUE_URL;

    await expect(
      useCase.execute(),
    ).rejects.toThrow(
      'SQS_EVENTS_QUEUE_URL is not configured',
    );

    expect(claimPending).not.toHaveBeenCalled();
    expect(sendFifo).not.toHaveBeenCalled();
  });
});
