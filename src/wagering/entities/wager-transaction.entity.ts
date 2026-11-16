import { randomUUID } from 'node:crypto';

import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Unique,
  Index,
} from '@mikro-orm/decorators/legacy';

import { WalletEntity } from '../../wallet/entities/wallet.entity.js';
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction.js';

@Entity({ tableName: 'wager_transactions' })
@Unique({
  properties: ['providerId', 'externalTransactionId'],
})
@Unique({
  properties: ['providerId', 'idempotencyKey'],
})
@Index({
  properties: ['providerId', 'referenceExternalTransactionId'],
})
export class WagerTransactionEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id: string = randomUUID();

  @Property({ length: 128 })
  providerId!: string;

  @Property({ length: 128 })
  externalTransactionId!: string;

  @Property({ length: 255 })
  idempotencyKey!: string;

  @Property({ length: 64 })
  payloadHash!: string;

  @ManyToOne(() => WalletEntity, {
    fieldName: 'wallet_id',
    deleteRule: 'restrict',
  })
  wallet!: WalletEntity;

  @Property({ length: 128 })
  playerId!: string;

  @Property({ length: 128 })
  roundId!: string;

  @Property({ length: 128 })
  gameId!: string;

  @Property({
    length: 16,
    columnType: 'varchar(16)',
  })
  kind!: WagerTransactionKind;

  @Property({
    length: 24,
    columnType: 'varchar(24)',
  })
  status: WagerTransactionStatus = WagerTransactionStatus.Pending;

  @Property({
    columnType: 'numeric(20, 2)',
  })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({
    length: 128,
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @ManyToOne(() => WagerTransactionEntity, {
    fieldName: 'reference_transaction_id',
    nullable: true,
    deleteRule: 'restrict',
  })
  referenceTransaction?: WagerTransactionEntity;

  @Property({
    length: 64,
    nullable: true,
    columnType: 'varchar(64)',
  })
  failureCode?: FailureCode;

  @Property({ columnType: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({
    columnType: 'timestamptz',
    nullable: true,
  })
  processedAt?: Date;

  @Property({
    fieldName: 'result_balance',
    columnType: 'numeric(20, 2)',
    nullable: true,
  })
  resultBalance?: string;
}
