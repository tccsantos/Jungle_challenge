import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';

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
  WagerTransactionStatus,
} from '../domain/wager-transaction.js';
import { WagerTransactionRepository } from '../repositories/wager-transaction.repository.js';

import { OutboxMessage } from '../../messaging/domain/outbox-message.js';
import { OutboxRepository } from '../../messaging/repositories/outbox.repository.js';
import { WagerTransactionProcessed } from '../../messaging/domain/events/wager-transaction-processed.event.js';
import { WagerTransactionRejected } from '../../messaging/domain/events/wager-transaction-rejected.event.js';
import { WalletBalanceChanged } from '../../messaging/domain/events/wallet-balance-changed.event.js';

import {
  MAX_REFERENCE_RETRY_ATTEMPTS,
  getReferenceRetryDelayMs,
} from './reference-retry-policy.js';

export interface RetryPendingReferencesResult {
  examined: number;
  processed: number;
  rejected: number;
  rescheduled: number;
  skipped: number;
}

type RetryOutcome =
  | 'processed'
  | 'rejected'
  | 'rescheduled'
  | 'skipped';

@Injectable()
export class RetryPendingReferencesUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepository,
    private readonly transactionRepository: WagerTransactionRepository,
    private readonly ledgerRepository: WalletLedgerRepository,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(
    limit: number = 50,
  ): Promise<RetryPendingReferencesResult> {
    const now = new Date();

    const candidates =
      await this.transactionRepository.findDuePendingReferences(
        now,
        limit,
        this.em.fork(),
      );

    const result: RetryPendingReferencesResult = {
      examined: candidates.length,
      processed: 0,
      rejected: 0,
      rescheduled: 0,
      skipped: 0,
    };

    for (const candidate of candidates) {
      const outcome = await this.processOne(
        candidate.id,
        candidate.walletId,
      );

      result[outcome]++;
    }

    return result;
  }

  private async processOne(
    transactionId: string,
    walletId: string,
  ): Promise<RetryOutcome> {
    return this.em.transactional(async (tx) => {
      // A mesma ordem de locks usada no processamento HTTP:
      // primeiro carteira, depois transação.
      const wallet =
        await this.walletRepository.findByIdForUpdate(
          walletId,
          tx,
        );

      if (!wallet) {
        throw new Error(
          `Wallet not found for transaction ${transactionId}`,
        );
      }

      const pending =
        await this.transactionRepository.findPendingReferenceForUpdate(
          transactionId,
          tx,
        );

      if (!pending) {
        return 'skipped';
      }

      const {
        transaction,
        retryAttempts,
        nextRetryAt,
      } = pending;

      const now = new Date();

      // Outra instância pode ter reagendado enquanto
      // aguardávamos o bloqueio da carteira.
      if (nextRetryAt && nextRetryAt > now) {
        return 'skipped';
      }

      const correlationId = transaction.id;

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
          amount: transaction.money.toDecimalString(),
          currency: transaction.money.currency,
        },
        referenceExternalTransactionId:
          transaction.referenceExternalTransactionId!,
      };

      const reject = async (
        failureCode: FailureCode,
      ): Promise<RetryOutcome> => {
        transaction.reject(failureCode);

        await this.transactionRepository.save(
          transaction,
          tx,
          wallet.balance,
        );

        const rejectedEvent = new WagerTransactionRejected({
          eventId: randomUUID(),
          aggregateId: wallet.id,
          correlationId,
          occurredAt: now,
          data: {
            ...eventData,
            failureCode,
          },
        });

        await this.outboxRepository.create(
          OutboxMessage.enqueue(rejectedEvent),
          tx,
        );

        return 'rejected';
      };

      const reference =
        await this.transactionRepository.findByExternalId(
          transaction.providerId,
          transaction.referenceExternalTransactionId!,
          tx,
        );

      if (
        !reference ||
        reference.status === WagerTransactionStatus.Pending ||
        reference.status === WagerTransactionStatus.PendingReference
      ) {
        const attempts = retryAttempts + 1;

        
      if (attempts >= MAX_REFERENCE_RETRY_ATTEMPTS) {
        await this.transactionRepository.recordReferenceRetryAttempt(
          transaction.id,
          attempts,
          tx,
        );

        return reject(FailureCode.ReferenceNotFound);
      }


        const delayMs = getReferenceRetryDelayMs(attempts);

        await this.transactionRepository.scheduleReferenceRetry(
          transaction.id,
          attempts,
          new Date(now.getTime() + delayMs),
          tx,
        );

        return 'rescheduled';
      }

      let direction: LedgerDirection;

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

      let change;

      try {
        change =
          direction === LedgerDirection.Debit
            ? wallet.debit(transaction.money)
            : wallet.credit(transaction.money);
      } catch (error) {
        if (!(error instanceof InsufficientFundsError)) {
          throw error;
        }

        return reject(FailureCode.ReversalWouldOverdraw);
      }

      transaction.markProcessed(now, reference.id);

      const ledgerEntry = WalletLedgerEntry.create({
        walletId: wallet.id,
        transactionId: transaction.id,
        direction,
        money: transaction.money,
        balanceBefore: change.balanceBefore,
        balanceAfter: change.balanceAfter,
      });

      await this.walletRepository.save(wallet, tx);

      await this.transactionRepository.save(
        transaction,
        tx,
        wallet.balance,
      );

      await this.ledgerRepository.create(
        ledgerEntry,
        tx,
      );

      const processedEvent = new WagerTransactionProcessed({
        eventId: randomUUID(),
        aggregateId: wallet.id,
        correlationId,
        occurredAt: now,
        data: eventData,
      });

      const balanceEvent = WalletBalanceChanged.from(
        wallet,
        ledgerEntry,
        {
          eventId: randomUUID(),
          correlationId,
          causationId: processedEvent.eventId,
          occurredAt: now,
        },
      );

      for (const event of [processedEvent, balanceEvent]) {
        await this.outboxRepository.create(
          OutboxMessage.enqueue(event),
          tx,
        );
      }

      return 'processed';
    });
  }
}
