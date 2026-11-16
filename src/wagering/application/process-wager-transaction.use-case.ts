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
    const supportedKinds = [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Loss,
    ];

    if (
      !input ||
      !supportedKinds.includes(input.kind as WagerTransactionKind)
    ) {
      throw new BadRequestException(
        'Unsupported transaction kind',
      );
    }

    if (
      typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey.trim()
    ) {
      throw new BadRequestException(
        'Idempotency-Key is required',
      );
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
      throw new BadRequestException(
        'Invalid transaction fields',
      );
    }

    if (
      typeof input.money?.amount !== 'string' ||
      typeof input.money?.currency !== 'string' ||
      input.referenceExternalTransactionId !== undefined
    ) {
      throw new BadRequestException('Invalid BET payload');
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
        'BET amount must be greater than zero',
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
    };

    const payloadHash = createWagerPayloadHash(normalizedInput);

    return this.em.transactional(async (tx) => {
      // Lock de linha no PostgreSQL, válido até o commit.
      const wallet =
        await this.walletRepository.findByIdForUpdate(
          input.walletId,
          tx,
        );

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      // Consultar depois de adquirir o lock.
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
            'Original transaction result is not available yet',
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
      });

      const correlationId = transaction.id;
      const occurredAt = new Date();

      const eventData = {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        roundId: transaction.roundId,
        gameId: transaction.gameId,
        kind: transaction.kind,
        money: {
          amount: money.toDecimalString(),
          currency: money.currency,
        },
      };

      try {
        if (transaction.kind === WagerTransactionKind.Loss) {
          transaction.markProcessed(occurredAt);

          await this.transactionRepository.create(
            transaction,
            tx,
            wallet.balance,
          );

          const processedEvent = new WagerTransactionProcessed({
            eventId: randomUUID(),
            aggregateId: wallet.id,
            correlationId,
            occurredAt,
            data: eventData,
          });

          await this.outboxRepository.create(
            OutboxMessage.enqueue(processedEvent),
            tx,
          );
        } else {
          const change =
            transaction.kind === WagerTransactionKind.Bet
              ? wallet.debit(money)
              : wallet.credit(money);

          const direction =
            transaction.kind === WagerTransactionKind.Bet
              ? LedgerDirection.Debit
              : LedgerDirection.Credit;

          transaction.markProcessed(occurredAt);

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
        }
      } catch (error) {
        // Somente a regra de saldo insuficiente é uma
        // rejeição de negócio. Outros erros precisam
        // provocar rollback da transação SQL.
        if (!(error instanceof InsufficientFundsError)) {
          throw error;
        }

        transaction.reject(FailureCode.InsufficientFunds);

        await this.transactionRepository.create(
          transaction,
          tx,
          wallet.balance,
        );

        const rejectedEvent = new WagerTransactionRejected({
            eventId: randomUUID(),
            aggregateId: wallet.id,
            correlationId,
            occurredAt,
            data: {
                ...eventData,
                failureCode: FailureCode.InsufficientFunds,
            },
        });

        await this.outboxRepository.create(
          OutboxMessage.enqueue(rejectedEvent),
          tx,
        );
      }

      return {
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
      };
    });
  }
}
