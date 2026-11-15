import { Injectable } from '@nestjs/common';
import {
  EntityManager,
  LockMode,
} from '@mikro-orm/core';

import { Money } from '../../shared/domain/money.js';
import { Wallet } from '../domain/wallet.js';
import { WalletEntity } from '../entities/wallet.entity.js';

@Injectable()
export class WalletRepository {
  constructor(
    private readonly em: EntityManager,
  ) {}

  async findById(
    id: string,
    em: EntityManager = this.em,
  ): Promise<Wallet | null> {
    const entity = await em.findOne(WalletEntity, { id });

    return entity ? this.toDomain(entity) : null;
  }

  async findByIdForUpdate(
    id: string,
    em: EntityManager,
  ): Promise<Wallet | null> {
    const entity = await em.findOne(
      WalletEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );

    return entity ? this.toDomain(entity) : null;
  }

  async save(
    wallet: Wallet,
    em: EntityManager = this.em,
  ): Promise<void> {
    const entity = await em.findOneOrFail(
      WalletEntity,
      { id: wallet.id },
    );

    entity.balance = wallet.balance.toDecimalString();
    entity.version = wallet.version;
    entity.updatedAt = wallet.updatedAt;
  }

  private toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.fromDecimal(
        entity.balance,
        entity.currency,
      ),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  async create(wallet: Wallet, em: EntityManager = this.em): Promise<void> {
    const entity = new WalletEntity();

    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = wallet.balance.toDecimalString();
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;

    em.persist(entity);
  }

}
