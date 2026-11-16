import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { MikroORM } from '@mikro-orm/postgresql';
import { ConflictException } from '@nestjs/common';

import mikroOrmConfig from '../../mikro-orm.config.js';
import { WalletEntity } from '../entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../../wagering/entities/wager-transaction.entity.js';
import { InboxMessageEntity } from '../../messaging/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../../messaging/entities/outbox-message.entity.js';

import { WalletRepository } from '../repositories/wallet.repository.js';
import { CreateWalletUseCase } from './create-wallet.use-case.js';
import { OutboxMessage } from '../../messaging/domain/outbox-message.js';

describe('CreateWalletUseCase - PostgreSQL integration', () => {
  let orm: MikroORM;

  const newPlayerId = () => `test-${randomUUID()}`;

  const createUseCase = () => {
    const em = orm.em.fork();
    const repository = new WalletRepository(em);
    return new CreateWalletUseCase(em, repository);
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  it('creates a wallet with zero initial balance', async () => {
    const playerId = newPlayerId();

    const result = await createUseCase().execute({
      playerId,
      initialBalance: {
        amount: '0.00',
        currency: 'BRL',
      },
    });

    expect(result.balance.amount).toBe('0.00');
    expect(result.version).toBe(1);

    const em = orm.em.fork();

    expect(
      await em.count(WalletEntity, { id: result.id }),
    ).toBe(1);

    expect(
      await em.count(WagerTransactionEntity, {
        wallet: result.id,
      }),
    ).toBe(0);

    expect(
      await em.count(WalletLedgerEntryEntity, {
        wallet: result.id,
      }),
    ).toBe(0);

    expect(
      await em.count(OutboxMessageEntity, {
        aggregateId: result.id,
      }),
    ).toBe(0);
  });

  it('creates OPENING, CREDIT ledger and two outbox events', async () => {
    const result = await createUseCase().execute({
      playerId: newPlayerId(),
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    });

    expect(result.balance.amount).toBe('100.00');
    expect(result.version).toBe(1);

    const em = orm.em.fork();

    const wallet = await em.findOneOrFail(
      WalletEntity,
      { id: result.id },
    );

    const transactions = await em.find(
      WagerTransactionEntity,
      { wallet: result.id },
    );

    const ledger = await em.find(
      WalletLedgerEntryEntity,
      { wallet: result.id },
    );

    const events = await em.find(
      OutboxMessageEntity,
      { aggregateId: result.id },
    );

    expect(wallet.balance).toBe('100.00');
    expect(wallet.version).toBe(1);

    expect(transactions).toHaveLength(1);
    expect(transactions[0].kind).toBe('OPENING');
    expect(transactions[0].status).toBe('PROCESSED');

    expect(ledger).toHaveLength(1);
    expect(ledger[0].direction).toBe('CREDIT');
    expect(ledger[0].amount).toBe('100.00');
    expect(ledger[0].balanceBefore).toBe('0.00');
    expect(ledger[0].balanceAfter).toBe('100.00');
    expect(ledger[0].transactionId).toBe(transactions[0].id);

    expect(events).toHaveLength(2);

    expect(events.map((event) => event.eventType).sort()).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);

    expect(events.every((event) => !event.publishedAt)).toBe(true);
  });

  it('rejects duplicate wallets without extra financial records', async () => {
    const playerId = newPlayerId();
    const useCase = createUseCase();

    const first = await useCase.execute({
      playerId,
      initialBalance: {
        amount: '50.00',
        currency: 'BRL',
      },
    });

    await expect(
      useCase.execute({
        playerId,
        initialBalance: {
          amount: '50.00',
          currency: 'BRL',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const em = orm.em.fork();

    expect(
      await em.count(WalletEntity, {
        playerId,
        currency: 'BRL',
      }),
    ).toBe(1);

    expect(
      await em.count(WagerTransactionEntity, {
        wallet: first.id,
      }),
    ).toBe(1);

    expect(
      await em.count(WalletLedgerEntryEntity, {
        wallet: first.id,
      }),
    ).toBe(1);

    expect(
      await em.count(OutboxMessageEntity, {
        aggregateId: first.id,
      }),
    ).toBe(2);
  });

  it('rolls back creation when outbox preparation fails', async () => {
    const playerId = newPlayerId();

    vi.spyOn(OutboxMessage, 'enqueue')
      .mockImplementationOnce(() => {
        throw new Error('Injected outbox failure');
      });

    await expect(
      createUseCase().execute({
        playerId,
        initialBalance: {
          amount: '75.00',
          currency: 'BRL',
        },
      }),
    ).rejects.toThrow('Injected outbox failure');

    const em = orm.em.fork();

    expect(
      await em.count(WalletEntity, {
        playerId,
        currency: 'BRL',
      }),
    ).toBe(0);
  });
});
