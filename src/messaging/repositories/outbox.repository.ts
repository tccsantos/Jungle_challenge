import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';

import { OutboxMessage } from '../domain/outbox-message.js';
import { OutboxMessageEntity } from '../entities/outbox-message.entity.js';

@Injectable()
export class OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async create(
    message: OutboxMessage,
    em: EntityManager = this.em,
  ): Promise<void> {
    const entity = new OutboxMessageEntity();

    entity.id = message.id;
    entity.aggregateId = message.aggregateId;
    entity.eventType = message.eventType;
    entity.payload = { ...message.payload };
    entity.occurredAt = message.occurredAt;
    entity.attempts = message.attempts;
    entity.nextAttemptAt = message.nextAttemptAt;
    entity.publishedAt = message.publishedAt;

    em.persist(entity);
  }
}
