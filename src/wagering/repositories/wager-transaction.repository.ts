import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';

import { Money } from '../../shared/domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
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

    em.persist(entity);
  }

  async save(
    transaction: WagerTransaction,
    em: EntityManager = this.em,
  ): Promise<void> {
    const entity = await em.findOneOrFail(
      WagerTransactionEntity,
      { id: transaction.id },
    );

    entity.status = transaction.status;
    entity.failureCode = transaction.failureCode;
    entity.processedAt = transaction.processedAt;

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
}
