import { randomUUID } from 'node:crypto';

import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallets' })
@Unique({
  properties: ['playerId', 'currency'],
})
export class WalletEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id: string = randomUUID();

  @Property({ length: 128 })
  playerId!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({
    columnType: 'numeric(20, 2)',
    default: '0.00',
  })
  balance: string = '0.00';

  @Property({ default: 1 })
  version: number = 1;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
