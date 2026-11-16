import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';
import { WalletEntity } from '../../wallet/entities/wallet.entity.js';

export interface TransactionDetails {
  id: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionEntity['kind'];
  status: WagerTransactionEntity['status'];
  amount: string;
  currency: string;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  failureCode: WagerTransactionEntity['failureCode'] | null;
  resultBalance: string | null;
  referenceRetryAttempts: number;
  referenceNextRetryAt: Date | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface TransactionHistory {
  walletId: string;
  total: number;
  limit: number;
  offset: number;
  transactions: TransactionDetails[];
}

@Injectable()
export class WagerTransactionQueryRepository {
  constructor(private readonly em: EntityManager) {}

  private toDetails(
    entity: WagerTransactionEntity,
  ): TransactionDetails {
    return {
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      walletId: entity.wallet.id,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      status: entity.status,
      amount: entity.amount,
      currency: entity.currency,
      referenceExternalTransactionId:
        entity.referenceExternalTransactionId ?? null,
      referenceTransactionId:
        entity.referenceTransaction?.id ?? null,
      failureCode: entity.failureCode ?? null,
      resultBalance: entity.resultBalance ?? null,
      referenceRetryAttempts: entity.referenceRetryAttempts,
      referenceNextRetryAt:
        entity.referenceNextRetryAt ?? null,
      createdAt: entity.createdAt,
      processedAt: entity.processedAt ?? null,
    };
  }

  async findById(
    id: string,
  ): Promise<TransactionDetails | null> {
    const em = this.em.fork();

    const entity = await em.findOne(
      WagerTransactionEntity,
      { id },
    );

    return entity ? this.toDetails(entity) : null;
  }

  async findByWallet(
    walletId: string,
    limit = 20,
    offset = 0,
  ): Promise<TransactionHistory | null> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new Error('Invalid transaction limit');
    }

    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('Invalid transaction offset');
    }

    const em = this.em.fork();

    const wallet = await em.findOne(
      WalletEntity,
      { id: walletId },
    );

    if (!wallet) {
      return null;
    }

    const [entities, total] = await em.findAndCount(
      WagerTransactionEntity,
      { wallet: walletId },
      {
        orderBy: {
          createdAt: 'desc',
          id: 'desc',
        },
        limit,
        offset,
      },
    );

    return {
      walletId,
      total,
      limit,
      offset,
      transactions: entities.map((entity) =>
        this.toDetails(entity),
      ),
    };
  }
}
