import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';

import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WalletEntity } from '../entities/wallet.entity.js';

@Injectable()
export class WalletLedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async create(
    entry: WalletLedgerEntry,
    em: EntityManager = this.em,
  ): Promise<void> {
    const entity = new WalletLedgerEntryEntity();

    entity.id = entry.id;
    entity.wallet = em.getReference(
      WalletEntity,
      entry.walletId,
    );
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.amount = entry.money.toDecimalString();
    entity.balanceBefore =
      entry.balanceBefore.toDecimalString();
    entity.balanceAfter =
      entry.balanceAfter.toDecimalString();
    entity.createdAt = entry.createdAt;

    em.persist(entity);
  }
}
