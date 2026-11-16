import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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

    useCase = new ProcessWagerCommandUseCase(
      inbox,
      processor,
    );
  });

  it('processes a valid command and confirms the inbox', async () => {
    const result = await useCase.execute(body());

    expect(result).toBe('PROCESSED');

    expect(receive).toHaveBeenCalledTimes(1);

    expect(receive).toHaveBeenCalledWith({
      messageId: MESSAGE_ID,
      consumerName: 'wager-commands',
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    expect(executeWager).toHaveBeenCalledExactlyOnceWith(
      command.data,
    );

    expect(markProcessed).toHaveBeenCalledTimes(1);

    expect(markProcessed).toHaveBeenCalledWith(
      receive.mock.calls[0][0],
    );
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

  it('accepts a concurrent inbox confirmation', async () => {
    markProcessed.mockResolvedValue(false);

    receive
      .mockResolvedValueOnce({
        alreadyProcessed: false,
      })
      .mockResolvedValueOnce({
        alreadyProcessed: true,
      });

    expect(
      await useCase.execute(body()),
    ).toBe('PROCESSED');

    expect(executeWager).toHaveBeenCalledTimes(1);
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
});
