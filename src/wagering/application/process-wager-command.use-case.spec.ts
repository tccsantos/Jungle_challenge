import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { EntityManager } from '@mikro-orm/postgresql';

import { createHash } from 'node:crypto';

import {
  InboxRepository,
  InboxPayloadConflictError,
} from '../../messaging/repositories/inbox.repository.js';

import {
  ProcessWagerTransactionUseCase,
} from './process-wager-transaction.use-case.js';

import {
  ProcessWagerCommandUseCase,
  InvalidWagerCommandError,
} from './process-wager-command.use-case.js';

import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction.js';

describe('ProcessWagerCommandUseCase', () => {
  const MESSAGE_ID =
    '11111111-1111-4111-8111-111111111111';

  const WALLET_ID =
    '22222222-2222-4222-8222-222222222222';

  const command = {
    messageId: MESSAGE_ID,
    commandType: 'ProcessWagerTransaction',
    schemaVersion: 1,
    data: {
      providerId: 'provider-test',
      externalTransactionId: 'bet-001',
      idempotencyKey: 'provider-test:bet-001',
      playerId: 'player-001',
      walletId: WALLET_ID,
      roundId: 'round-001',
      gameId: 'game-001',
      kind: WagerTransactionKind.Bet,
      money: {
        amount: '10.00',
        currency: 'BRL',
      },
    },
  };

  const newEnvelope = () => ({
    messageId: MESSAGE_ID,
    type: 'WagerTransactionRequested',
    occurredAt: '2026-11-16T13:30:00.000Z',
    data: structuredClone(command.data),
  });

  const newBody = () => JSON.stringify(newEnvelope());

  let useCase: ProcessWagerCommandUseCase;

  let receive: ReturnType<typeof vi.fn>;
  let markProcessed: ReturnType<typeof vi.fn>;
  let executeWager: ReturnType<typeof vi.fn>;

  const body = () => JSON.stringify(command);

  beforeEach(() => {
    receive = vi.fn().mockResolvedValue({
      alreadyProcessed: false,
    });

    markProcessed = vi.fn().mockResolvedValue(true);

    executeWager = vi.fn().mockResolvedValue({
      transactionId:
        '33333333-3333-4333-8333-333333333333',
      status: WagerTransactionStatus.Processed,
      balance: {
        amount: '90.00',
        currency: 'BRL',
      },
      idempotentReplay: false,
    });

    const inbox = {
      receive,
      markProcessed,
    } as unknown as InboxRepository;

    const processor = {
      execute: executeWager,
    } as unknown as ProcessWagerTransactionUseCase;

    
    const tx = {} as EntityManager;

    const em = {
      transactional: vi.fn(async (
        callback: (tx: EntityManager) => Promise<unknown>,
      ) => callback(tx)),
    } as unknown as EntityManager;

    useCase = new ProcessWagerCommandUseCase(
      inbox,
      processor,
      em,
    );

  });

  it('processes a valid command and confirms the inbox', async () => {
    const result = await useCase.execute(body());

    expect(result).toBe('PROCESSED');

    expect(receive).toHaveBeenCalledTimes(1);

    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: MESSAGE_ID,
        consumerName: 'wager-commands',
      }),
      expect.anything(),
    );

    expect(executeWager).toHaveBeenCalledWith(
      command.data,
      expect.anything(),
    );

    expect(markProcessed).toHaveBeenCalledTimes(1);

    
    expect(markProcessed).toHaveBeenCalledWith(
      receive.mock.calls[0][0],
      expect.anything(),
    );

    const inboxTx = receive.mock.calls[0][1];
    const financialTx = executeWager.mock.calls[0][1];
    const confirmationTx = markProcessed.mock.calls[0][1];

    expect(inboxTx).toBeDefined();
    expect(inboxTx).toBe(financialTx);
    expect(financialTx).toBe(confirmationTx);

  });

  it('does not execute a message already processed', async () => {
    receive.mockResolvedValue({
      alreadyProcessed: true,
    });

    const result = await useCase.execute(body());

    expect(result).toBe('ALREADY_PROCESSED');
    expect(executeWager).not.toHaveBeenCalled();
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('does not confirm the inbox when financial processing fails', async () => {
    executeWager.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await expect(
      useCase.execute(body()),
    ).rejects.toThrow('Database unavailable');

    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('rejects a message ID reused with different payload', async () => {
    receive.mockRejectedValue(
      new InboxPayloadConflictError(),
    );

    await expect(
      useCase.execute(body()),
    ).rejects.toBeInstanceOf(
      InboxPayloadConflictError,
    );

    expect(executeWager).not.toHaveBeenCalled();
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON without touching the database', async () => {
    await expect(
      useCase.execute('{invalid'),
    ).rejects.toBeInstanceOf(
      InvalidWagerCommandError,
    );

    expect(receive).not.toHaveBeenCalled();
    expect(executeWager).not.toHaveBeenCalled();
  });

  it('rejects a command with missing financial fields', async () => {
    const invalid = {
      ...command,
      data: {
        ...command.data,
        walletId: '',
      },
    };

    await expect(
      useCase.execute(JSON.stringify(invalid)),
    ).rejects.toBeInstanceOf(
      InvalidWagerCommandError,
    );

    expect(receive).not.toHaveBeenCalled();
    expect(executeWager).not.toHaveBeenCalled();
  });

  it('recovers when financial processing succeeds but inbox confirmation fails', async () => {
    markProcessed.mockResolvedValue(false);

    receive
      .mockResolvedValueOnce({
        alreadyProcessed: false,
      })
      .mockResolvedValueOnce({
        alreadyProcessed: false,
      });

    await expect(
      useCase.execute(body()),
    ).rejects.toThrow(
      'Unable to confirm inbox processing',
    );

    expect(executeWager).toHaveBeenCalledTimes(1);
    expect(markProcessed).toHaveBeenCalledTimes(1);
  });

  it('fails when inbox confirmation cannot be completed', async () => {
    markProcessed.mockResolvedValue(false);

    await expect(
      useCase.execute(body()),
    ).rejects.toThrow(
      'Unable to confirm inbox processing',
    );

    expect(executeWager).toHaveBeenCalledTimes(1);
    expect(markProcessed).toHaveBeenCalledTimes(1);
  });

  it('does not process a command whose inbox record cannot be read', async () => {
    receive.mockRejectedValue(
      new Error('PostgreSQL unavailable'),
    );

    await expect(
      useCase.execute(body()),
    ).rejects.toThrow('PostgreSQL unavailable');

    expect(executeWager).not.toHaveBeenCalled();
  });

  describe('WagerTransactionRequested envelope', () => {
    it('processes the new SQS envelope successfully', async () => {
      const result = await useCase.execute(newBody());

      expect(result).toBe('PROCESSED');

      expect(receive).toHaveBeenCalledTimes(1);
      expect(receive).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: MESSAGE_ID,
          consumerName: 'wager-commands',
        }),
        expect.anything(),
      );

      expect(executeWager).toHaveBeenCalledWith(
        command.data,
        expect.anything(),
      );

      expect(markProcessed).toHaveBeenCalledTimes(1);
    });

    it('recognizes a redelivered new-envelope message', async () => {
      receive.mockResolvedValue({
        alreadyProcessed: true,
      });

      const result = await useCase.execute(newBody());

      expect(result).toBe('ALREADY_PROCESSED');
      expect(executeWager).not.toHaveBeenCalled();
      expect(markProcessed).not.toHaveBeenCalled();
    });

    it('rejects an unsupported message type', async () => {
      const invalid = {
        ...newEnvelope(),
        type: 'UnknownCommand',
      };

      await expect(
        useCase.execute(JSON.stringify(invalid)),
      ).rejects.toThrow('Unsupported wager message type');

      expect(receive).not.toHaveBeenCalled();
    });

    it('rejects an absent occurredAt', async () => {
      const invalid = { ...newEnvelope() } as Record<
        string,
        unknown
      >;

      delete invalid.occurredAt;

      await expect(
        useCase.execute(JSON.stringify(invalid)),
      ).rejects.toThrow('Invalid occurredAt');

      expect(receive).not.toHaveBeenCalled();
    });

    it('rejects an invalid occurredAt', async () => {
      const invalid = {
        ...newEnvelope(),
        occurredAt: 'invalid-date',
      };

      await expect(
        useCase.execute(JSON.stringify(invalid)),
      ).rejects.toThrow('Invalid occurredAt');

      expect(receive).not.toHaveBeenCalled();
    });

    it('rejects a missing messageId', async () => {
      const invalid = {
        ...newEnvelope(),
        messageId: '',
      };

      await expect(
        useCase.execute(JSON.stringify(invalid)),
      ).rejects.toBeInstanceOf(
        InvalidWagerCommandError,
      );

      expect(receive).not.toHaveBeenCalled();
    });

    it('rejects a new envelope with empty walletId', async () => {
      const invalid = newEnvelope();
      invalid.data.walletId = '';

      await expect(
        useCase.execute(JSON.stringify(invalid)),
      ).rejects.toThrow('Invalid wager transaction fields');

      expect(receive).not.toHaveBeenCalled();
      expect(executeWager).not.toHaveBeenCalled();
    });

    it('rejects a numeric monetary amount', async () => {
      const invalid = {
        ...newEnvelope(),
        data: {
          ...command.data,
          money: {
            amount: 10,
            currency: 'BRL',
          },
        },
      };

      await expect(
        useCase.execute(JSON.stringify(invalid)),
      ).rejects.toThrow('Invalid wager transaction fields');

      expect(receive).not.toHaveBeenCalled();
      expect(executeWager).not.toHaveBeenCalled();
    });

    it('preserves the raw message hash in the inbox', async () => {
      const rawBody = newBody();

      await useCase.execute(rawBody);

      const inboxInput = receive.mock.calls[0][0] as {
        messageId: string;
        consumerName: string;
        payloadHash: string;
      };

      expect(inboxInput.messageId).toBe(MESSAGE_ID);
      expect(inboxInput.payloadHash).toBe(
        createHash('sha256')
          .update(rawBody)
          .digest('hex'),
      );

      expect(markProcessed).toHaveBeenCalledWith(
        inboxInput,
        expect.anything(),
      );
    });

    it('does not process a new-envelope message on inbox conflict', async () => {
      receive.mockRejectedValue(
        new InboxPayloadConflictError(),
      );

      await expect(
        useCase.execute(newBody()),
      ).rejects.toBeInstanceOf(
        InboxPayloadConflictError,
      );

      expect(executeWager).not.toHaveBeenCalled();
      expect(markProcessed).not.toHaveBeenCalled();
    });

    it('uses the same transaction for inbox and financial processing', async () => {
      await useCase.execute(newBody());

      const inboxTx = receive.mock.calls[0][1];
      const financialTx = executeWager.mock.calls[0][1];
      const confirmationTx = markProcessed.mock.calls[0][1];

      expect(inboxTx).toBe(financialTx);
      expect(financialTx).toBe(confirmationTx);
    });

    it('rejects a REFUND without reference transaction', async () => {
      const invalid = {
        ...newEnvelope(),
        data: {
          ...command.data,
          kind: WagerTransactionKind.Refund,
        },
      };

      await expect(
        useCase.execute(JSON.stringify(invalid)),
      ).rejects.toThrow(
        'Invalid reference for transaction kind',
      );

      expect(receive).not.toHaveBeenCalled();
    });
  });

});
