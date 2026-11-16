import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../mikro-orm.config.js';

import { WalletEntity } from '../../wallet/entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../../wallet/entities/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../../wagering/entities/wager-transaction.entity.js';
import { InboxMessageEntity } from '../entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../entities/outbox-message.entity.js';

import {
  InboxRepository,
  InboxPayloadConflictError,
} from './inbox.repository.js';

describe('InboxRepository - PostgreSQL', () => {
  let orm: MikroORM;

  const createdIds: string[] = [];
  const consumerName = 'inbox-integration-test';

  const makeInput = () => {
    const messageId = randomUUID();
    createdIds.push(messageId);

    return {
      messageId,
      consumerName,
      payloadHash: 'a'.repeat(64),
    };
  };

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }

    const databaseName = new URL(databaseUrl)
      .pathname.replace(/^\/+/, '');

    if (databaseName !== 'jungle_processor_test') {
      throw new Error(
        'Integration tests must use jungle_processor_test',
      );
    }

    orm = await MikroORM.init({
      ...mikroOrmConfig,
      clientUrl: databaseUrl,
      entities: [
        WalletEntity,
        WalletLedgerEntryEntity,
        WagerTransactionEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ],
      entitiesTs: [],
      debug: false,
    });
  });

  afterEach(async () => {
    if (createdIds.length === 0) {
      return;
    }

    await orm.em.fork().nativeDelete(
      InboxMessageEntity,
      {
        consumerName,
        messageId: { $in: createdIds },
      },
    );

    createdIds.length = 0;
  });

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  it('persists a new message as unprocessed', async () => {
    const repository = new InboxRepository(orm.em.fork());
    const input = makeInput();

    const result = await repository.receive(input);

    expect(result.alreadyProcessed).toBe(false);
    expect(result.message.messageId).toBe(input.messageId);
    expect(result.message.isProcessed()).toBe(false);

    const stored = await orm.em.fork().findOneOrFail(
      InboxMessageEntity,
      {
        consumerName,
        messageId: input.messageId,
      },
    );

    expect(stored.processedAt).toBeNull();
    expect(stored.payloadHash).toBe(input.payloadHash);
  });

  it('recognizes an already processed message', async () => {
    const repository = new InboxRepository(orm.em.fork());
    const input = makeInput();

    await repository.receive(input);

    expect(await repository.markProcessed(input)).toBe(true);

    const repeated = await new InboxRepository(
      orm.em.fork(),
    ).receive(input);

    expect(repeated.alreadyProcessed).toBe(true);
    expect(repeated.message.isProcessed()).toBe(true);

    // Não pode confirmar uma segunda vez.
    expect(await repository.markProcessed(input)).toBe(false);
  });

  it('rejects a different payload with the same message ID', async () => {
    const repository = new InboxRepository(orm.em.fork());
    const input = makeInput();

    await repository.receive(input);

    await expect(
      repository.receive({
        ...input,
        payloadHash: 'b'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(InboxPayloadConflictError);

    const stored = await orm.em.fork().findOneOrFail(
      InboxMessageEntity,
      {
        consumerName,
        messageId: input.messageId,
      },
    );

    expect(stored.payloadHash).toBe(input.payloadHash);
  });

  it('handles concurrent deliveries of the same message', async () => {
    const input = makeInput();

    const firstRepository = new InboxRepository(
      orm.em.fork(),
    );

    const secondRepository = new InboxRepository(
      orm.em.fork(),
    );

    const [first, second] = await Promise.all([
      firstRepository.receive(input),
      secondRepository.receive(input),
    ]);

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(false);

    const count = await orm.em.fork().count(
      InboxMessageEntity,
      {
        consumerName,
        messageId: input.messageId,
      },
    );

    expect(count).toBe(1);
  });

  it('allows recovery of a received but unprocessed message', async () => {
    const input = makeInput();

    const firstRepository = new InboxRepository(
      orm.em.fork(),
    );

    await firstRepository.receive(input);

    // Simula uma nova instância após uma interrupção.
    const recoveredRepository = new InboxRepository(
      orm.em.fork(),
    );

    const recovered =
      await recoveredRepository.receive(input);

    expect(recovered.alreadyProcessed).toBe(false);

    expect(
      await recoveredRepository.markProcessed(input),
    ).toBe(true);

    const finalState =
      await firstRepository.receive(input);

    expect(finalState.alreadyProcessed).toBe(true);
  });
});
