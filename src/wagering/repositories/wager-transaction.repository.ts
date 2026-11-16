import { Injectable } from '@nestjs/common';
import { 
  EntityManager,
  LockMode 
} from '@mikro-orm/core';

import { Money } from '../../shared/domain/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';
import { WalletEntity } from '../../wallet/entities/wallet.entity.js';

@Injectable()
export class WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
    em: EntityManager = this.em,
  ): Promise<WagerTransaction | null> {
    const entity = await em.findOne(WagerTransactionEntity, {
      providerId,
      idempotencyKey,
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByExternalId(
    providerId: string,
    externalTransactionId: string,
    em: EntityManager = this.em,
  ): Promise<WagerTransaction | null> {
    const entity = await em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });

    return entity ? this.toDomain(entity) : null;
  }

  async create(
    transaction: WagerTransaction,
    em: EntityManager = this.em,
    resultBalance?: Money,
  ): Promise<void> {
    const entity = new WagerTransactionEntity();

    entity.id = transaction.id;
    entity.providerId = transaction.providerId;
    entity.externalTransactionId =
      transaction.externalTransactionId;
    entity.idempotencyKey = transaction.idempotencyKey;
    entity.payloadHash = transaction.payloadHash;

    entity.wallet = em.getReference(
      WalletEntity,
      transaction.walletId,
    );

    entity.playerId = transaction.playerId;
    entity.roundId = transaction.roundId;
    entity.gameId = transaction.gameId;
    entity.kind = transaction.kind;
    entity.status = transaction.status;

    entity.amount = transaction.money.toDecimalString();
    entity.currency = transaction.money.currency;

    entity.referenceExternalTransactionId =
      transaction.referenceExternalTransactionId;

    if (transaction.referenceTransactionId) {
      entity.referenceTransaction = em.getReference(
        WagerTransactionEntity,
        transaction.referenceTransactionId,
      );
    }

    entity.failureCode = transaction.failureCode;
    entity.createdAt = transaction.createdAt;
    entity.processedAt = transaction.processedAt;
    entity.resultBalance = resultBalance?.toDecimalString();

    em.persist(entity);
  }

  async save(
    transaction: WagerTransaction,
    em: EntityManager = this.em,
    resultBalance?: Money,
  ): Promise<void> {
    const entity = await em.findOneOrFail(
      WagerTransactionEntity,
      { id: transaction.id },
    );

    entity.status = transaction.status;
    entity.failureCode = transaction.failureCode;
    entity.processedAt = transaction.processedAt;

    if (resultBalance !== undefined) {
        entity.resultBalance = resultBalance.toDecimalString();
    }

    entity.referenceTransaction = transaction.referenceTransactionId
      ? em.getReference(
          WagerTransactionEntity,
          transaction.referenceTransactionId,
        )
      : undefined;
  }

  private toDomain(
    entity: WagerTransactionEntity,
  ): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.wallet.id,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: Money.fromDecimal(
        entity.amount,
        entity.currency,
      ),
      referenceExternalTransactionId:
        entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: entity.status,
      referenceTransactionId:
        entity.referenceTransaction?.id,
      failureCode: entity.failureCode,
      processedAt: entity.processedAt,
    });
  }


  async findByIdempotencyKeyWithResult(
    providerId: string,
    idempotencyKey: string,
    em: EntityManager = this.em,
  ): Promise<{
    transaction: WagerTransaction;
    resultBalance: Money | null;
    } | null> {
    const entity = await em.findOne(WagerTransactionEntity, {
        providerId,
        idempotencyKey,
    });

    if (!entity) {
        return null;
    }

    return {
        transaction: this.toDomain(entity),
        resultBalance:
        entity.resultBalance == null
            ? null
            : Money.fromDecimal(
                entity.resultBalance,
                entity.currency,
            ),
    };
  }


  async findProcessedReversal(
    providerId: string,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
    em: EntityManager = this.em,
  ): Promise<WagerTransaction | null> {
    const entity = await em.findOne(WagerTransactionEntity, {
      providerId,
      referenceTransaction: referenceTransactionId,
      kind,
      status: WagerTransactionStatus.Processed,
    });

    return entity ? this.toDomain(entity) : null;
  }


  async findDuePendingReferences(
    now: Date,
    limit: number = 50,
    em: EntityManager = this.em,
  ): Promise<WagerTransaction[]> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new Error('Limit must be between 1 and 100');
    }

    const entities = await em.find(
      WagerTransactionEntity,
      {
        status: WagerTransactionStatus.PendingReference,
        $or: [
          { referenceNextRetryAt: null },
          { referenceNextRetryAt: { $lte: now } },
        ],
      },
      {
        orderBy: {
          createdAt: 'asc',
          id: 'asc',
        },
        limit,
      },
    );

    return entities.map((entity) => this.toDomain(entity));
  }


  async findPendingReferenceForUpdate(
    transactionId: string,
    em: EntityManager,
  ): Promise<{
    transaction: WagerTransaction;
    retryAttempts: number;
    nextRetryAt: Date | null;
  } | null> {
    const entity = await em.findOne(
      WagerTransactionEntity,
      {
        id: transactionId,
        status: WagerTransactionStatus.PendingReference,
      },
      {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      },
    );

    if (!entity) {
      return null;
    }

    return {
      transaction: this.toDomain(entity),
      retryAttempts: entity.referenceRetryAttempts,
      nextRetryAt: entity.referenceNextRetryAt ?? null,
    };
  }


  async scheduleReferenceRetry(
    transactionId: string,
    attempts: number,
    nextRetryAt: Date,
    em: EntityManager,
  ): Promise<void> {
    if (!Number.isInteger(attempts) || attempts < 1) {
      throw new Error('Invalid retry attempts');
    }

    if (Number.isNaN(nextRetryAt.getTime())) {
      throw new Error('Invalid retry date');
    }

    const entity = await em.findOneOrFail(
      WagerTransactionEntity,
      {
        id: transactionId,
        status: WagerTransactionStatus.PendingReference,
      },
    );

    entity.referenceRetryAttempts = attempts;
    entity.referenceNextRetryAt = nextRetryAt;

    // Sem flush aqui: as alterações serão persistidas
    // junto ao commit da transação SQL do worker.
  }


}
