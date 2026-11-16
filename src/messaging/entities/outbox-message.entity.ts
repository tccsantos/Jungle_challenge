import { randomUUID } from 'node:crypto';
import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'outbox_messages' })
@Index({
  name: 'outbox_messages_pending_idx',
  properties: ['publishedAt', 'nextAttemptAt', 'occurredAt'],
})
@Index({
  name: 'outbox_messages_lease_idx',
  properties: ['publishedAt', 'leaseUntil', 'nextAttemptAt'],
})
export class OutboxMessageEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id: string = randomUUID();

  @Property({ fieldName: 'aggregate_id', length: 255 })
  aggregateId!: string;

  @Property({ fieldName: 'event_type', length: 128 })
  eventType!: string;

  @Property({ columnType: 'jsonb' })
  payload!: Record<string, unknown>;

  @Property({ fieldName: 'occurred_at', columnType: 'timestamptz' })
  occurredAt: Date = new Date();

  @Property({ default: 0 })
  attempts: number = 0;

  @Property({
    fieldName: 'next_attempt_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  nextAttemptAt?: Date;

  @Property({
    fieldName: 'published_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  publishedAt?: Date;

  @Property({
    fieldName: 'lease_token',
    columnType: 'uuid',
    nullable: true,
  })
  leaseToken?: string;

  @Property({
    fieldName: 'lease_until',
    columnType: 'timestamptz',
    nullable: true,
  })
  leaseUntil?: Date;

}
