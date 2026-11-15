import { randomUUID } from 'node:crypto';

import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_messages' })
@Unique({
  properties: ['consumerName', 'messageId'],
})
export class InboxMessageEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id: string = randomUUID();

  @Property({
    fieldName: 'message_id',
    length: 255,
  })
  messageId!: string;

  @Property({
    fieldName: 'consumer_name',
    length: 128,
  })
  consumerName!: string;

  @Property({
    fieldName: 'payload_hash',
    length: 64,
  })
  payloadHash!: string;

  @Property({
    fieldName: 'received_at',
    columnType: 'timestamptz',
  })
  receivedAt: Date = new Date();

  @Property({
    fieldName: 'processed_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  processedAt?: Date;
}
