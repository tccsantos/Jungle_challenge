import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';

import { OutboxMessage } from '../domain/outbox-message.js';
import { OutboxMessageEntity } from '../entities/outbox-message.entity.js';


export interface ClaimedOutboxMessage {
  message: OutboxMessage;
  leaseToken: string;
}

interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts: number;
  next_attempt_at: Date | null;
  published_at: Date | null;
  lease_token: string;
}


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


  async claimPending(
    limit: number = 20,
  ): Promise<ClaimedOutboxMessage[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid outbox batch limit');
    }

    const leaseToken = randomUUID();

    const rows = await this.em.fork().execute<OutboxRow[]>(
      `
        WITH candidates AS (
          SELECT o.id
          FROM outbox_messages o
          WHERE o.published_at IS NULL
            AND (
              o.next_attempt_at IS NULL
              OR o.next_attempt_at <= NOW()
            )
            AND (
              o.lease_until IS NULL
              OR o.lease_until <= NOW()
            )
            AND NOT EXISTS (
              SELECT 1
              FROM outbox_messages previous
              WHERE previous.aggregate_id = o.aggregate_id
                AND previous.published_at IS NULL
                AND previous.publish_order < o.publish_order
            )
          ORDER BY o.publish_order ASC
          LIMIT ?
          FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE outbox_messages o
        SET
          lease_token = ?::uuid,
          lease_until = NOW() + INTERVAL '120 seconds'
        FROM candidates
        WHERE o.id = candidates.id
        RETURNING o.*
      `,
      [limit, leaseToken],
      'all',
    );

    return rows.map((row) => ({
      leaseToken,
      message: OutboxMessage.rehydrate({
        id: row.id,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        occurredAt: new Date(row.occurred_at),
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at
          ? new Date(row.next_attempt_at)
          : undefined,
        publishedAt: row.published_at
          ? new Date(row.published_at)
          : undefined,
      }),
    }));
  }

  
  async confirmPublished(
    claimed: ClaimedOutboxMessage,
  ): Promise<boolean> {
    const publishedAt = new Date();

    const rows = await this.em.fork().execute<Array<{ id: string }>>(
      `
        UPDATE outbox_messages
        SET
          published_at = ?,
          next_attempt_at = NULL,
          lease_token = NULL,
          lease_until = NULL
        WHERE id = ?::uuid
          AND lease_token = ?::uuid
          AND lease_until > NOW()
          AND published_at IS NULL
        RETURNING id
      `,
      [
        publishedAt,
        claimed.message.id,
        claimed.leaseToken,
      ],
      'all',
    );

    if (rows.length === 0) {
      return false;
    }

    claimed.message.markPublished(publishedAt);
    return true;
  }

  async schedulePublishRetry(
    claimed: ClaimedOutboxMessage,
  ): Promise<boolean> {
    const now = new Date();

    // Calcula o novo estado sem modificar o objeto original.
    const updated = OutboxMessage.rehydrate({
      id: claimed.message.id,
      aggregateId: claimed.message.aggregateId,
      eventType: claimed.message.eventType,
      payload: claimed.message.payload,
      occurredAt: claimed.message.occurredAt,
      attempts: claimed.message.attempts,
      nextAttemptAt: claimed.message.nextAttemptAt,
      publishedAt: claimed.message.publishedAt,
    });

    updated.scheduleRetry(now);

    const rows = await this.em.fork().execute<Array<{ id: string }>>(
      `
        UPDATE outbox_messages
        SET
          attempts = ?,
          next_attempt_at = ?,
          lease_token = NULL,
          lease_until = NULL
        WHERE id = ?::uuid
          AND lease_token = ?::uuid
          AND lease_until > NOW()
          AND published_at IS NULL
        RETURNING id
      `,
      [
        updated.attempts,
        updated.nextAttemptAt,
        claimed.message.id,
        claimed.leaseToken,
      ],
      'all',
    );

    if (rows.length === 0) {
      return false;
    }

    claimed.message.scheduleRetry(now);
    return true;
  }


}
