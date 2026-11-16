
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';

import { Money } from '../../shared/domain/money.js';
import { Wallet } from '../domain/wallet.js';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../domain/wallet-ledger-entry.js';
import { WalletRepository } from '../repositories/wallet.repository.js';
import { WalletEntity } from '../entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';

import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../wagering/domain/wager-transaction.js';
import { WagerTransactionEntity } from '../../wagering/entities/wager-transaction.entity.js';

import { OutboxMessage } from '../../messaging/domain/outbox-message.js';
import { OutboxMessageEntity } from '../../messaging/entities/outbox-message.entity.js';
import { WagerTransactionProcessed } from '../../messaging/domain/events/wager-transaction-processed.event.js';
import { WalletBalanceChanged } from '../../messaging/domain/events/wallet-balance-changed.event.js';

export interface CreateWalletInput {
  playerId: string;
  initialBalance: {
    amount: string;
    currency: string;
  };
}

export interface CreateWalletOutput {
  id: string;
  playerId: string;
  balance: {
    amount: string;
    currency: string;
  };
  version: number;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepository,
  ) {}

  async execute(input: CreateWalletInput): Promise<CreateWalletOutput> {
    if (
      typeof input?.playerId !== 'string' ||
      !input.playerId.trim()
    ) {
      throw new BadRequestException('playerId is required');
    }

    if (
      typeof input.initialBalance?.amount !== 'string' ||
      typeof input.initialBalance?.currency !== 'string'
    ) {
      throw new BadRequestException('Invalid initialBalance');
    }

    let initialBalance: Money;

    try {
      initialBalance = Money.fromDecimal(
        input.initialBalance.amount,
        input.initialBalance.currency,
      );
    } catch {
      throw new BadRequestException('Invalid initialBalance');
    }

    if (initialBalance.isNegative()) {
      throw new BadRequestException(
        'Initial balance cannot be negative',
      );
    }

    try {
      return await this.em.transactional(async (tx) => {
        const wallet = Wallet.open({
          id: randomUUID(),
          playerId: input.playerId.trim(),
          initialBalance,
        });

        await this.walletRepository.create(wallet, tx);

        if (!initialBalance.isZero()) {
          const openingId = `opening:${wallet.id}`;

          const transaction = WagerTransaction.create({
            providerId: 'internal',
            externalTransactionId: openingId,
            idempotencyKey: openingId,
            payloadHash: createHash('sha256')
              .update(openingId)
              .digest('hex'),
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: openingId,
            gameId: 'wallet-opening',
            kind: WagerTransactionKind.Opening,
            money: initialBalance,
          });

          transaction.markProcessed(new Date());

          const ledgerEntry = WalletLedgerEntry.create({
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: LedgerDirection.Credit,
            money: initialBalance,
            balanceBefore: Money.zero(wallet.currency),
            balanceAfter: wallet.balance,
          });

          const walletReference = tx.getReference(
            WalletEntity,
            wallet.id,
          );

          const transactionEntity = new WagerTransactionEntity();

          transactionEntity.id = transaction.id;
          transactionEntity.providerId = transaction.providerId;
          transactionEntity.externalTransactionId =
            transaction.externalTransactionId;
          transactionEntity.idempotencyKey = transaction.idempotencyKey;
          transactionEntity.payloadHash = transaction.payloadHash;
          transactionEntity.wallet = walletReference;
          transactionEntity.playerId = transaction.playerId;
          transactionEntity.roundId = transaction.roundId;
          transactionEntity.gameId = transaction.gameId;
          transactionEntity.kind = transaction.kind;
          transactionEntity.status = transaction.status;
          transactionEntity.amount = transaction.money.toDecimalString();
          transactionEntity.currency = transaction.money.currency;
          transactionEntity.createdAt = transaction.createdAt;
          transactionEntity.processedAt = transaction.processedAt;

          tx.persist(transactionEntity);

          const ledgerEntity = new WalletLedgerEntryEntity();

          ledgerEntity.id = ledgerEntry.id;
          ledgerEntity.wallet = walletReference;
          ledgerEntity.transactionId = ledgerEntry.transactionId;
          ledgerEntity.direction = ledgerEntry.direction;
          ledgerEntity.amount = ledgerEntry.money.toDecimalString();
          ledgerEntity.balanceBefore =
            ledgerEntry.balanceBefore.toDecimalString();
          ledgerEntity.balanceAfter =
            ledgerEntry.balanceAfter.toDecimalString();
          ledgerEntity.createdAt = ledgerEntry.createdAt;

          tx.persist(ledgerEntity);

          const processedEvent = new WagerTransactionProcessed({
            eventId: randomUUID(),
            aggregateId: wallet.id,
            correlationId: wallet.id,
            occurredAt: transaction.processedAt ?? new Date(),
            data: {
              transactionId: transaction.id,
              providerId: transaction.providerId,
              externalTransactionId:
                transaction.externalTransactionId,
              walletId: wallet.id,
              playerId: wallet.playerId,
              roundId: transaction.roundId,
              gameId: transaction.gameId,
              kind: transaction.kind,
              money: {
                amount: transaction.money.toDecimalString(),
                currency: transaction.money.currency,
              },
            },
          });

          const balanceEvent = WalletBalanceChanged.from(
            wallet,
            ledgerEntry,
            {
              eventId: randomUUID(),
              correlationId: wallet.id,
              causationId: processedEvent.eventId,
              occurredAt: ledgerEntry.createdAt,
            },
          );

          for (const event of [processedEvent, balanceEvent]) {
            const outbox = OutboxMessage.enqueue(event);

            const outboxEntity = new OutboxMessageEntity();

            outboxEntity.id = outbox.id;
            outboxEntity.aggregateId = outbox.aggregateId;
            outboxEntity.eventType = outbox.eventType;
            outboxEntity.payload = { ...outbox.payload };
            outboxEntity.occurredAt = outbox.occurredAt;
            outboxEntity.attempts = outbox.attempts;
            outboxEntity.nextAttemptAt = outbox.nextAttemptAt;
            outboxEntity.publishedAt = outbox.publishedAt;

            tx.persist(outboxEntity);
          }
        }

        return {
          id: wallet.id,
          playerId: wallet.playerId,
          balance: {
            amount: wallet.balance.toDecimalString(),
            currency: wallet.currency,
          },
          version: wallet.version,
        };
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException(
          'Wallet already exists for this player and currency',
        );
      }

      throw error;
    }
  }
}
