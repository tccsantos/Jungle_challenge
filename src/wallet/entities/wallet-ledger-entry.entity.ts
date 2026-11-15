import { randomUUID } from 'node:crypto';

import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Unique,
} from '@mikro-orm/decorators/legacy';

import { WalletEntity } from './wallet.entity.js';
import { LedgerDirection } from '../domain/wallet-ledger-entry.js';

@Entity({ tableName: 'wallet_ledger_entries' })
@Unique({
  properties: ['wallet', 'transactionId'],
})
export class WalletLedgerEntryEntity {
    @PrimaryKey({ columnType: 'uuid' })
    id: string = randomUUID();

    @ManyToOne(() => WalletEntity, {
        fieldName: 'wallet_id',
        deleteRule: 'restrict',
    })
    wallet!: WalletEntity;

    @Property({
        fieldName: 'transaction_id',
        columnType: 'uuid',
    })
    transactionId!: string;

    @Property({
    length: 6,
    columnType: 'varchar(6)',
    })
    direction!: LedgerDirection;

    @Property({ columnType: 'numeric(20, 2)' })
    amount!: string;

    @Property({
        fieldName: 'balance_before',
        columnType: 'numeric(20, 2)',
    })
    balanceBefore!: string;

    @Property({
        fieldName: 'balance_after',
        columnType: 'numeric(20, 2)',
    })
    balanceAfter!: string;

    @Property({
        columnType: 'timestamptz',
    })
    createdAt: Date = new Date();
}
