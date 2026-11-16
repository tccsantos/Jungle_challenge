import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';

import { Money } from '../../shared/domain/money.js';
import {
  InsufficientFundsError,
} from '../../wallet/domain/wallet.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../wallet/domain/wallet-ledger-entry.js';
import { WalletRepository } from '../../wallet/repositories/wallet.repository.js';
import { WalletLedgerRepository } from '../../wallet/repositories/wallet-ledger.repository.js';

import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction.js';
import { WagerTransactionRepository } from '../repositories/wager-transaction.repository.js';

import { OutboxMessage } from '../../messaging/domain/outbox-message.js';
import { OutboxRepository } from '../../messaging/repositories/outbox.repository.js';
import { WagerTransactionProcessed } from '../../messaging/domain/events/wager-transaction-processed.event.js';
import { WagerTransactionRejected } from '../../messaging/domain/events/wager-transaction-rejected.event.js';
import { WagerTransactionPendingReference } from '../../messaging/domain/events/wager-transaction-pending-reference.event.js';
import { WalletBalanceChanged } from '../../messaging/domain/events/wallet-balance-changed.event.js';

import {
  createWagerPayloadHash,
  type WagerPayload,
} from './wager-payload-hash.js';

export interface ProcessWagerInput extends WagerPayload {
  idempotencyKey: string;
}

export interface ProcessWagerOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: {
    amount: string;
    currency: string;
  };
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepository,
    private readonly transactionRepository: WagerTransactionRepository,
    private readonly ledgerRepository: WalletLedgerRepository,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(
    input: ProcessWagerInput,
  ): Promise<ProcessWagerOutput> {
    const supportedKinds: WagerTransactionKind[] = [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Loss,
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ];

    if (
      !input ||
      !supportedKinds.includes(input.kind as WagerTransactionKind)
    ) {
      throw new BadRequestException('Unsupported transaction kind');
    }

    if (
      typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey.trim()
    ) {
      throw new BadRequestException('Idempotency-Key is required');
    }

    const requiredFields = [
      input.providerId,
      input.externalTransactionId,
      input.walletId,
      input.playerId,
      input.roundId,
      input.gameId,
    ];

    if (
      requiredFields.some(
        (value) => typeof value !== 'string' || !value.trim(),
      )
    ) {
      throw new BadRequestException('Invalid transaction fields');
    }

    const requiresReference =
      input.kind === WagerTransactionKind.Refund ||
      input.kind === WagerTransactionKind.Rollback;

    if (
      typeof input.money?.amount !== 'string' ||
      typeof input.money?.currency !== 'string'
    ) {
      throw new BadRequestException('Invalid money');
    }

    if (
      requiresReference &&
      (
        typeof input.referenceExternalTransactionId !== 'string' ||
        !input.referenceExternalTransactionId.trim()
      )
    ) {
      throw new BadRequestException(
        'Reference transaction is required',
      );
    }

    if (
      !requiresReference &&
      input.referenceExternalTransactionId !== undefined
    ) {
      throw new BadRequestException(
        'This transaction kind cannot have a reference',
      );
    }

    let money: Money;

    try {
      money = Money.fromDecimal(
        input.money.amount,
        input.money.currency,
      );
    } catch {
      throw new BadRequestException('Invalid money');
    }

    if (money.isNegative() || money.isZero()) {
      throw new BadRequestException(
        'Transaction amount must be greater than zero',
      );
    }

    const normalizedInput: WagerPayload = {
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: {
        amount: money.toDecimalString(),
        currency: money.currency,
      },
      referenceExternalTransactionId:
        input.referenceExternalTransactionId,
    };

    const payloadHash = createWagerPayloadHash(normalizedInput);

    return this.em.transactional(async (tx) => {
      const wallet =
        await this.walletRepository.findByIdForUpdate(
          input.walletId,
          tx,
        );

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      const existing =
        await this.transactionRepository.findByIdempotencyKeyWithResult(
          input.providerId,
          input.idempotencyKey,
          tx,
        );

      if (existing) {
        if (!existing.transaction.matchesPayload(payloadHash)) {
          throw new ConflictException(
            'Idempotency key reused with different payload',
          );
        }

        if (!existing.resultBalance) {
          throw new ConflictException(
            'Original transaction result is not available',
          );
        }

        return {
          transactionId: existing.transaction.id,
          status: existing.transaction.status,
          balance: {
            amount: existing.resultBalance.toDecimalString(),
            currency: existing.resultBalance.currency,
          },
          idempotentReplay: true,
          ...(existing.transaction.failureCode
            ? { failureCode: existing.transaction.failureCode }
            : {}),
        };
      }

      const existingExternal =
        await this.transactionRepository.findByExternalId(
          input.providerId,
          input.externalTransactionId,
          tx,
        );

      if (existingExternal) {
        throw new ConflictException(
          'External transaction ID already exists',
        );
      }

      if (
        wallet.playerId !== input.playerId ||
        wallet.currency !== money.currency
      ) {
        throw new BadRequestException(
          'Wallet player or currency mismatch',
        );
      }

      const transaction = WagerTransaction.create({
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind as WagerTransactionKind,
        money,
        referenceExternalTransactionId:
          input.referenceExternalTransactionId,
      });

      const correlationId = transaction.id;
      const occurredAt = new Date();

      const eventData = {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId:
          transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        roundId: transaction.roundId,
        gameId: transaction.gameId,
        kind: transaction.kind,
        money: {
          amount: money.toDecimalString(),
          currency: money.currency,
        },
        ...(transaction.referenceExternalTransactionId
          ? {
              referenceExternalTransactionId:
                transaction.referenceExternalTransactionId,
            }
          : {}),
      };

      const output = (): ProcessWagerOutput => ({
        transactionId: transaction.id,
        status: transaction.status,
        balance: {
          amount: wallet.balance.toDecimalString(),
          currency: wallet.currency,
        },
        idempotentReplay: false,
        ...(transaction.failureCode
          ? { failureCode: transaction.failureCode }
          : {}),
      });

      const reject = async (
        failureCode: FailureCode,
      ): Promise<ProcessWagerOutput> => {
        transaction.reject(failureCode);

        await this.transactionRepository.create(
          transaction,
          tx,
          wallet.balance,
        );

        const event = new WagerTransactionRejected({
          eventId: randomUUID(),
          aggregateId: wallet.id,
          correlationId,
          occurredAt,
          data: {
            ...eventData,
            failureCode,
          },
        });

        await this.outboxRepository.create(
          OutboxMessage.enqueue(event),
          tx,
        );

        return output();
      };

      // LOSS não altera saldo e não produz ledger.
      if (transaction.kind === WagerTransactionKind.Loss) {
        transaction.markProcessed(occurredAt);

        await this.transactionRepository.create(
          transaction,
          tx,
          wallet.balance,
        );

        const event = new WagerTransactionProcessed({
          eventId: randomUUID(),
          aggregateId: wallet.id,
          correlationId,
          occurredAt,
          data: eventData,
        });

        await this.outboxRepository.create(
          OutboxMessage.enqueue(event),
          tx,
        );

        return output();
      }

      let direction: LedgerDirection;
      let reference: WagerTransaction | undefined;

      if (transaction.requiresReference()) {
        reference =
          await this.transactionRepository.findByExternalId(
            transaction.providerId,
            transaction.referenceExternalTransactionId!,
            tx,
          ) ?? undefined;

        if (
          !reference ||
          reference.status === WagerTransactionStatus.Pending ||
          reference.status === WagerTransactionStatus.PendingReference
        ) {
          transaction.markPendingReference();

          await this.transactionRepository.create(
            transaction,
            tx,
            wallet.balance,
          );

          const event = new WagerTransactionPendingReference({
            eventId: randomUUID(),
            aggregateId: wallet.id,
            correlationId,
            occurredAt,
            data: {
              ...eventData,
              referenceExternalTransactionId:
                transaction.referenceExternalTransactionId!,
            },
          });

          await this.outboxRepository.create(
            OutboxMessage.enqueue(event),
            tx,
          );

          return output();
        }

        try {
          direction = transaction.ledgerDirectionFor(reference);
        } catch {
          return reject(FailureCode.InvalidReference);
        }

        const previousReversal =
          await this.transactionRepository.findProcessedReversal(
            transaction.providerId,
            reference.id,
            transaction.kind,
            tx,
          );

        if (previousReversal) {
          return reject(FailureCode.InvalidReference);
        }
      } else {
        direction = transaction.ledgerDirectionFor();
      }

      let change;

      try {
        change =
          direction === LedgerDirection.Debit
            ? wallet.debit(money)
            : wallet.credit(money);
      } catch (error) {
        if (!(error instanceof InsufficientFundsError)) {
          throw error;
        }

        return reject(
          transaction.requiresReference()
            ? FailureCode.ReversalWouldOverdraw
            : FailureCode.InsufficientFunds,
        );
      }

      transaction.markProcessed(
        occurredAt,
        reference?.id,
      );

      const ledgerEntry = WalletLedgerEntry.create({
        walletId: wallet.id,
        transactionId: transaction.id,
        direction,
        money,
        balanceBefore: change.balanceBefore,
        balanceAfter: change.balanceAfter,
      });

      await this.walletRepository.save(wallet, tx);

      await this.transactionRepository.create(
        transaction,
        tx,
        wallet.balance,
      );

      await this.ledgerRepository.create(ledgerEntry, tx);

      const processedEvent = new WagerTransactionProcessed({
        eventId: randomUUID(),
        aggregateId: wallet.id,
        correlationId,
        occurredAt,
        data: eventData,
      });

      const balanceEvent = WalletBalanceChanged.from(
        wallet,
        ledgerEntry,
        {
          eventId: randomUUID(),
          correlationId,
          causationId: processedEvent.eventId,
          occurredAt,
        },
      );

      for (const event of [processedEvent, balanceEvent]) {
        await this.outboxRepository.create(
          OutboxMessage.enqueue(event),
          tx,
        );
      }

      return output();
    });
  }
}
