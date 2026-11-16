import { randomUUID } from 'node:crypto';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
} from 'vitest';

import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../../mikro-orm.config.js';

import { WalletEntity } from '../../wallet/entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../../wallet/entities/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';
import { InboxMessageEntity } from '../../messaging/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../../messaging/entities/outbox-message.entity.js';

import { WalletRepository } from '../../wallet/repositories/wallet.repository.js';
import { WalletLedgerRepository } from '../../wallet/repositories/wallet-ledger.repository.js';
import { WagerTransactionRepository } from '../repositories/wager-transaction.repository.js';
import { OutboxRepository } from '../../messaging/repositories/outbox.repository.js';
import { 
    WagerTransactionKind,
    WagerTransactionStatus,
    FailureCode
 } from '../domain/wager-transaction.js';

import { CreateWalletUseCase } from '../../wallet/application/create-wallet.use-case.js';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case.js';
import { LedgerDirection } from '../../wallet/domain/wallet-ledger-entry.js';

describe('ProcessWagerTransactionUseCase - PostgreSQL', () => {
  let orm: MikroORM;

  const uniqueId = () => randomUUID();

  const createWallet = async (amount = '100.00') => {
    const em = orm.em.fork();

    const useCase = new CreateWalletUseCase(
      em,
      new WalletRepository(em),
    );

    return useCase.execute({
      playerId: `player-${uniqueId()}`,
      initialBalance: {
        amount,
        currency: 'BRL',
      },
    });
  };

  const createProcessor = () => {
    const em = orm.em.fork();

    return new ProcessWagerTransactionUseCase(
      em,
      new WalletRepository(em),
      new WagerTransactionRepository(em),
      new WalletLedgerRepository(em),
      new OutboxRepository(em),
    );
  };

  const betInput = (
    wallet: { id: string; playerId: string },
    amount: string,
  ) => {
    const externalTransactionId = `bet-${uniqueId()}`;

    return {
      providerId: 'provider-test',
      externalTransactionId,
      idempotencyKey: `provider-test:${externalTransactionId}`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-test',
      gameId: 'game-test',
      kind: 'BET',
      money: {
        amount,
        currency: 'BRL',
      },
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

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  it('processes BET and rejects insufficient funds', async () => {
    const wallet = await createWallet();
    const processor = createProcessor();

    const processed = await processor.execute(
      betInput(wallet, '70.00'),
    );

    expect(processed.status).toBe(WagerTransactionStatus.Processed);
    expect(processed.balance.amount).toBe('30.00');
    expect(processed.idempotentReplay).toBe(false);

    const rejected = await processor.execute(
      betInput(wallet, '50.00'),
    );

    expect(rejected.status).toBe(WagerTransactionStatus.Rejected);
    expect(rejected.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(rejected.balance.amount).toBe('30.00');

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
      WalletEntity,
      { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('30.00');
    expect(storedWallet.version).toBe(2);

    const transactions = await em.find(
      WagerTransactionEntity,
      { wallet: wallet.id },
    );

    // OPENING + BET processada + BET rejeitada
    expect(transactions).toHaveLength(3);

    const ledger = await em.find(
      WalletLedgerEntryEntity,
      { wallet: wallet.id },
    );

    // OPENING CREDIT + BET DEBIT
    expect(ledger).toHaveLength(2);

    const events = await em.find(
      OutboxMessageEntity,
      { aggregateId: wallet.id },
    );

    // OPENING (2) + BET processada (2) + rejeitada (1)
    expect(events).toHaveLength(5);
  });

  it('replays the original balance after later operations', async () => {
    const wallet = await createWallet();
    const processor = createProcessor();

    const originalInput = betInput(wallet, '30.00');

    const original = await processor.execute(originalInput);

    expect(original.status).toBe(WagerTransactionStatus.Processed);
    expect(original.balance.amount).toBe('70.00');

    const second = await processor.execute(
      betInput(wallet, '20.00'),
    );

    expect(second.balance.amount).toBe('50.00');

    const replay = await processor.execute(originalInput);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transactionId).toBe(original.transactionId);
    expect(replay.balance.amount).toBe('70.00');

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
      WalletEntity,
      { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('50.00');

    expect(
      await em.count(WalletLedgerEntryEntity, {
        wallet: wallet.id,
      }),
    ).toBe(3);
  });

  it('prevents two concurrent BETs from overdraw', async () => {
    const wallet = await createWallet();

    const inputA = betInput(wallet, '80.00');
    const inputB = betInput(wallet, '80.00');

    // Processadores diferentes, EntityManagers diferentes.
    const [resultA, resultB] = await Promise.all([
      createProcessor().execute(inputA),
      createProcessor().execute(inputB),
    ]);

    const results = [resultA, resultB];

    expect(
      results.filter((r) => r.status === WagerTransactionStatus.Processed),
    ).toHaveLength(1);

    expect(
      results.filter((r) => r.status === WagerTransactionStatus.Rejected),
    ).toHaveLength(1);

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
      WalletEntity,
      { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('20.00');
    expect(storedWallet.version).toBe(2);

    const ledger = await em.find(
      WalletLedgerEntryEntity,
      { wallet: wallet.id },
    );

    // Um crédito de abertura e exatamente um débito.
    expect(
      ledger.filter((entry) => entry.direction === LedgerDirection.Debit),
    ).toHaveLength(1);

    expect(
      ledger.filter((entry) => entry.direction === LedgerDirection.Credit),
    ).toHaveLength(1);

    const transactions = await em.find(
      WagerTransactionEntity,
      { wallet: wallet.id },
    );

    expect(
      transactions.filter(
        (transaction) =>
          transaction.kind === WagerTransactionKind.Bet &&
          transaction.status === WagerTransactionStatus.Processed,
      ),
    ).toHaveLength(1);

    expect(
      transactions.filter(
        (transaction) =>
          transaction.kind === WagerTransactionKind.Bet &&
          transaction.status === WagerTransactionStatus.Rejected,
      ),
    ).toHaveLength(1);
  });
});
