import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import { InboxMessage } from '../domain/inbox-message.js';

export interface ReceiveInboxInput {
  messageId: string;
  consumerName: string;
  payloadHash: string;
}

export interface ReceiveInboxResult {
  message: InboxMessage;
  alreadyProcessed: boolean;
}

interface InboxRow {
  message_id: string;
  consumer_name: string;
  payload_hash: string;
  received_at: Date;
  processed_at: Date | null;
}

export class InboxPayloadConflictError extends Error {
  constructor() {
    super('Inbox message ID reused with different payload');
    this.name = 'InboxPayloadConflictError';
  }
}

@Injectable()
export class InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async receive(
    input: ReceiveInboxInput,
    tx?: EntityManager,
  ): Promise<ReceiveInboxResult> {
    const message = InboxMessage.receive(input);

    const em = tx ?? this.em.fork();

    await em.execute(
      `
        INSERT INTO inbox_messages (
          id,
          message_id,
          consumer_name,
          payload_hash,
          received_at
        )
        VALUES (
          gen_random_uuid(),
          ?,
          ?,
          ?,
          NOW()
        )
        ON CONFLICT (consumer_name, message_id)
        DO NOTHING
      `,
      [
        message.messageId,
        message.consumerName,
        message.payloadHash,
      ],
    );

    const rows = await em.execute<InboxRow[]>(
      `
        SELECT
          message_id,
          consumer_name,
          payload_hash,
          received_at,
          processed_at
        FROM inbox_messages
        WHERE consumer_name = ?
          AND message_id = ?
      `,
      [
        message.consumerName,
        message.messageId,
      ],
      'all',
    );

    const row = rows[0];

    if (!row) {
      throw new Error('Inbox message was not persisted');
    }

    if (row.payload_hash !== message.payloadHash) {
      throw new InboxPayloadConflictError();
    }

    const stored = InboxMessage.rehydrate({
      messageId: row.message_id,
      consumerName: row.consumer_name,
      payloadHash: row.payload_hash,
      receivedAt: new Date(row.received_at),
      processedAt: row.processed_at
        ? new Date(row.processed_at)
        : undefined,
    });

    return {
      message: stored,
      alreadyProcessed: stored.isProcessed(),
    };
  }

  async markProcessed(
    input: ReceiveInboxInput,
    tx?: EntityManager,
  ): Promise<boolean> {
    const rows = await (tx ?? this.em.fork()).execute<
      Array<{ message_id: string }>
    >(
      `
        UPDATE inbox_messages
        SET processed_at = NOW()
        WHERE consumer_name = ?
          AND message_id = ?
          AND payload_hash = ?
          AND processed_at IS NULL
        RETURNING message_id
      `,
      [
        input.consumerName,
        input.messageId,
        input.payloadHash,
      ],
      'all',
    );

    return rows.length === 1;
  }
}
