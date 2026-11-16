import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import {
  InboxRepository,
} from '../../messaging/repositories/inbox.repository.js';  

import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerInput,
} from './process-wager-transaction.use-case.js';

import {
  WagerTransactionKind,
} from '../domain/wager-transaction.js';

interface WagerCommandEnvelope {
  messageId: string;
  commandType: 'ProcessWagerTransaction';
  schemaVersion: 1;
  data: ProcessWagerInput;
}

export type WagerCommandResult =
  | 'PROCESSED'
  | 'ALREADY_PROCESSED';

export class InvalidWagerCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWagerCommandError';
  }
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseCommand(body: string): WagerCommandEnvelope {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidWagerCommandError(
      'Message body must be valid JSON',
    );
  }

  if (!isObject(parsed)) {
    throw new InvalidWagerCommandError(
      'Message body must be an object',
    );
  }

  if (
    !isNonEmptyString(parsed.messageId) ||
    parsed.commandType !== 'ProcessWagerTransaction' ||
    parsed.schemaVersion !== 1 ||
    !isObject(parsed.data)
  ) {
    throw new InvalidWagerCommandError(
      'Invalid wager command envelope',
    );
  }

  const data = parsed.data;

  const kinds = [
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Loss,
    WagerTransactionKind.Refund,
    WagerTransactionKind.Rollback,
  ];

  if (
    !isNonEmptyString(data.providerId) ||
    !isNonEmptyString(data.externalTransactionId) ||
    !isNonEmptyString(data.idempotencyKey) ||
    !isNonEmptyString(data.playerId) ||
    !isNonEmptyString(data.walletId) ||
    !isNonEmptyString(data.roundId) ||
    !isNonEmptyString(data.gameId) ||
    !kinds.some((kind) => kind === data.kind) ||
    !isObject(data.money) ||
    !isNonEmptyString(data.money.amount) ||
    !isNonEmptyString(data.money.currency)
  ) {
    throw new InvalidWagerCommandError(
      'Invalid wager transaction fields',
    );
  }

  if (
    data.referenceExternalTransactionId !== undefined &&
    !isNonEmptyString(data.referenceExternalTransactionId)
  ) {
    throw new InvalidWagerCommandError(
      'Invalid reference transaction',
    );
  }

  const requiresReference =
    data.kind === WagerTransactionKind.Refund ||
    data.kind === WagerTransactionKind.Rollback;

  if (
    requiresReference !==
    (data.referenceExternalTransactionId !== undefined)
  ) {
    throw new InvalidWagerCommandError(
      'Invalid reference for transaction kind',
    );
  }

  const input: ProcessWagerInput = {
    providerId: data.providerId,
    externalTransactionId: data.externalTransactionId,
    idempotencyKey: data.idempotencyKey,
    playerId: data.playerId,
    walletId: data.walletId,
    roundId: data.roundId,
    gameId: data.gameId,
    kind: data.kind as WagerTransactionKind,
    money: {
      amount: data.money.amount,
      currency: data.money.currency,
    },
    ...(requiresReference
      ? {
          referenceExternalTransactionId:
            data.referenceExternalTransactionId as string,
        }
      : {}),
  };

  return {
    messageId: parsed.messageId,
    commandType: 'ProcessWagerTransaction',
    schemaVersion: 1,
    data: input,
  };
}


@Injectable()
export class ProcessWagerCommandUseCase {
  private readonly logger = new Logger(
    ProcessWagerCommandUseCase.name,
  );

  constructor(
    private readonly inboxRepository: InboxRepository,
    private readonly processWager:
      ProcessWagerTransactionUseCase,
    private readonly em: EntityManager,
  ) {}

  async execute(body: string): Promise<WagerCommandResult> {
    // Validamos a mensagem antes de abrir a transação.
    const command = parseCommand(body);

    const payloadHash = createHash('sha256')
      .update(body)
      .digest('hex');

    const inboxInput = {
      messageId: command.messageId,
      consumerName: 'wager-commands',
      payloadHash,
    };

    const result = await this.em.transactional(
      async (tx): Promise<{
        outcome: WagerCommandResult;
        status?: string;
      }> => {
        // INSERT e leitura ocorrem no mesmo tx.
        const received =
          await this.inboxRepository.receive(inboxInput, tx);

        if (received.alreadyProcessed) {
          return { outcome: 'ALREADY_PROCESSED' };
        }

        // Wallet, Transaction, Ledger e Outbox usam tx.
        const wagerResult = await this.processWager.execute(
          command.data,
          tx,
        );

        // Marcação da Inbox antes do COMMIT.
        const confirmed =
          await this.inboxRepository.markProcessed(
            inboxInput,
            tx,
          );

        if (!confirmed) {
          throw new Error(
            'Unable to confirm inbox processing',
          );
        }

        return {
          outcome: 'PROCESSED',
          status: wagerResult.status,
        };
      },
    );

    // Só registramos sucesso após o commit.
    this.logger.log(
      `Wager command ${command.messageId}: ${
        result.status ?? result.outcome
      }`,
    );

    return result.outcome;
  }
}
