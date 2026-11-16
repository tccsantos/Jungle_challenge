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
      kind: WagerTransactionKind.Bet,
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


  it('processes the same BET 50 times concurrently only once', async () => {
    const wallet = await createWallet('100.00');

    const input = betInput(wallet, '25.00');

    const results = await Promise.all(
        Array.from({ length: 50 }, () =>
        createProcessor().execute(input),
        ),
    );

    expect(
        results.filter((result) => !result.idempotentReplay),
    ).toHaveLength(1);

    expect(
        results.filter((result) => result.idempotentReplay),
    ).toHaveLength(49);

    const transactionIds = new Set(
        results.map((result) => result.transactionId),
    );

    expect(transactionIds.size).toBe(1);

    expect(
        results.every(
        (result) =>
            result.status === WagerTransactionStatus.Processed &&
            result.balance.amount === '75.00',
        ),
    ).toBe(true);

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('75.00');
    expect(storedWallet.version).toBe(2);

    const transactions = await em.find(
        WagerTransactionEntity,
        {
        wallet: wallet.id,
        kind: WagerTransactionKind.Bet,
        },
    );

    expect(transactions).toHaveLength(1);

    const ledger = await em.find(
        WalletLedgerEntryEntity,
        { wallet: wallet.id },
    );

    expect(
        ledger.filter((entry) => entry.direction === LedgerDirection.Debit),
    ).toHaveLength(1);

    const events = await em.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    // Dois eventos de abertura e dois da BET.
    expect(events).toHaveLength(4);
  });


  it('rejects the same idempotency key with different payload', async () => {
    const wallet = await createWallet('100.00');
    const processor = createProcessor();

    const input = betInput(wallet, '20.00');

    const original = await processor.execute(input);

    expect(original.status).toBe(WagerTransactionStatus.Processed);

    await expect(
        processor.execute({
        ...input,
        money: {
            amount: '30.00',
            currency: 'BRL',
        },
        }),
    ).rejects.toThrow();

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('80.00');

    expect(
        await em.count(WagerTransactionEntity, {
        wallet: wallet.id,
        kind: WagerTransactionKind.Bet,
        }),
    ).toBe(1);
  });


  it('processes WIN with credit, ledger and outbox events', async () => {
    const wallet = await createWallet('100.00');
    const processor = createProcessor();

    const input = {
        ...betInput(wallet, '50.00'),
        kind: WagerTransactionKind.Win,
    };

    const result = await processor.execute(input);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('150.00');
    expect(result.idempotentReplay).toBe(false);

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('150.00');
    expect(storedWallet.version).toBe(2);

    const ledger = await em.find(
        WalletLedgerEntryEntity,
        { transactionId: result.transactionId },
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0].direction).toBe(LedgerDirection.Credit);
    expect(ledger[0].amount).toBe('50.00');
    expect(ledger[0].balanceBefore).toBe('100.00');
    expect(ledger[0].balanceAfter).toBe('150.00');

    const transaction = await em.findOneOrFail(
        WagerTransactionEntity,
        { id: result.transactionId },
    );

    expect(transaction.kind).toBe(WagerTransactionKind.Win);
    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.resultBalance).toBe('150.00');

    const events = await em.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    const transactionEvents = events.filter(
        (event) =>
        (event.payload.data as { transactionId?: string })
            ?.transactionId === result.transactionId,
    );

    expect(
        transactionEvents.map((event) => event.eventType).sort(),
    ).toEqual([
        'WagerTransactionProcessed',
        'WalletBalanceChanged',
    ]);
  });


  it('processes LOSS without changing balance or ledger', async () => {
    const wallet = await createWallet('100.00');
    const processor = createProcessor();

    const input = {
        ...betInput(wallet, '50.00'),
        kind: WagerTransactionKind.Loss,
    };

    const result = await processor.execute(input);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('100.00');
    expect(result.idempotentReplay).toBe(false);

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('100.00');
    expect(storedWallet.version).toBe(1);

    const transaction = await em.findOneOrFail(
        WagerTransactionEntity,
        { id: result.transactionId },
    );

    expect(transaction.kind).toBe(WagerTransactionKind.Loss);
    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.resultBalance).toBe('100.00');

    const ledgerCount = await em.count(
        WalletLedgerEntryEntity,
        { transactionId: result.transactionId },
    );

    expect(ledgerCount).toBe(0);

    const events = await em.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    const transactionEvents = events.filter(
        (event) =>
        (event.payload.data as { transactionId?: string })
            ?.transactionId === result.transactionId,
    );

    expect(transactionEvents).toHaveLength(1);
    expect(transactionEvents[0].eventType).toBe(
        'WagerTransactionProcessed',
    );
  });


  it('refunds a processed BET exactly once', async () => {
    const wallet = await createWallet('100.00');
    const processor = createProcessor();

    const bet = betInput(wallet, '40.00');

    const betResult = await processor.execute(bet);

    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
    expect(betResult.balance.amount).toBe('60.00');

    const refund = {
        ...betInput(wallet, '40.00'),
        kind: WagerTransactionKind.Refund,
        roundId: bet.roundId,
        referenceExternalTransactionId: bet.externalTransactionId,
    };

    const refundResult = await processor.execute(refund);

    expect(refundResult.status).toBe(WagerTransactionStatus.Processed);
    expect(refundResult.balance.amount).toBe('100.00');

    const em = orm.em.fork();

    const transaction = await em.findOneOrFail(
        WagerTransactionEntity,
        { id: refundResult.transactionId },
    );

    expect(transaction.kind).toBe(WagerTransactionKind.Refund);
    expect(transaction.referenceTransaction?.id).toBe(
        betResult.transactionId,
    );

    const ledger = await em.find(
        WalletLedgerEntryEntity,
        { transactionId: refundResult.transactionId },
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0].direction).toBe(LedgerDirection.Credit);
    expect(ledger[0].balanceBefore).toBe('60.00');
    expect(ledger[0].balanceAfter).toBe('100.00');

    // Outra operação REFUND para a mesma BET.
    const duplicate = {
        ...refund,
        externalTransactionId: `refund-${uniqueId()}`,
        idempotencyKey: `refund-${uniqueId()}`,
    };

    const duplicateResult = await processor.execute(duplicate);

    expect(duplicateResult.status).toBe(WagerTransactionStatus.Rejected);
    expect(duplicateResult.failureCode).toBe(FailureCode.InvalidReference);
    expect(duplicateResult.balance.amount).toBe('100.00');

    const finalEm = orm.em.fork();

    expect(
        await finalEm.count(WalletLedgerEntryEntity, {
        wallet: wallet.id,
        direction: LedgerDirection.Credit,
        }),
    ).toBe(2); // OPENING + primeiro REFUND
  });


  it('rolls back a processed WIN by debiting the wallet', async () => {
    const wallet = await createWallet('100.00');
    const processor = createProcessor();

    const win = {
        ...betInput(wallet, '40.00'),
        kind: WagerTransactionKind.Win,
    };

    const winResult = await processor.execute(win);

    expect(winResult.status).toBe(WagerTransactionStatus.Processed);
    expect(winResult.balance.amount).toBe('140.00');

    const rollback = {
        ...betInput(wallet, '40.00'),
        kind: WagerTransactionKind.Rollback,
        roundId: win.roundId,
        referenceExternalTransactionId: win.externalTransactionId,
    };

    const result = await processor.execute(rollback);

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.amount).toBe('100.00');

    const em = orm.em.fork();

    const transaction = await em.findOneOrFail(
        WagerTransactionEntity,
        { id: result.transactionId },
    );

    expect(transaction.kind).toBe(WagerTransactionKind.Rollback);
    expect(transaction.referenceTransaction?.id).toBe(
        winResult.transactionId,
    );

    const ledger = await em.find(
        WalletLedgerEntryEntity,
        { transactionId: result.transactionId },
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0].direction).toBe(LedgerDirection.Debit);
    expect(ledger[0].amount).toBe('40.00');
    expect(ledger[0].balanceBefore).toBe('140.00');
    expect(ledger[0].balanceAfter).toBe('100.00');

    const storedWallet = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('100.00');
    expect(storedWallet.version).toBe(3);
  });


  it('stores PENDING_REFERENCE without changing the wallet', async () => {
    const wallet = await createWallet('100.00');
    const processor = createProcessor();

    const refund = {
        ...betInput(wallet, '40.00'),
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: `missing-${uniqueId()}`,
    };

    const result = await processor.execute(refund);

    expect(result.status).toBe(WagerTransactionStatus.PendingReference);
    expect(result.balance.amount).toBe('100.00');

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('100.00');
    expect(storedWallet.version).toBe(1);

    const transaction = await em.findOneOrFail(
        WagerTransactionEntity,
        { id: result.transactionId },
    );

    expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(transaction.referenceExternalTransactionId).toBe(
        refund.referenceExternalTransactionId,
    );

    expect(
        await em.count(WalletLedgerEntryEntity, {
        transactionId: result.transactionId,
        }),
    ).toBe(0);

    const events = await em.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    const transactionEvents = events.filter(
        (event) =>
        (event.payload.data as { transactionId?: string })
            ?.transactionId === result.transactionId,
    );

    expect(transactionEvents).toHaveLength(1);
    expect(transactionEvents[0].eventType).toBe(
        'WagerTransactionPendingReference',
    );
  });


  it('rejects ROLLBACK when reversal would overdraw', async () => {
    const wallet = await createWallet('100.00');
    const processor = createProcessor();

    const win = {
        ...betInput(wallet, '80.00'),
        kind: WagerTransactionKind.Win,
    };

    const winResult = await processor.execute(win);

    expect(winResult.balance.amount).toBe('180.00');

    const betResult = await processor.execute(
        betInput(wallet, '150.00'),
    );

    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
    expect(betResult.balance.amount).toBe('30.00');

    const rollback = {
        ...betInput(wallet, '80.00'),
        kind: WagerTransactionKind.Rollback,
        roundId: win.roundId,
        referenceExternalTransactionId: win.externalTransactionId,
    };

    const result = await processor.execute(rollback);

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(
        FailureCode.ReversalWouldOverdraw,
    );
    expect(result.balance.amount).toBe('30.00');

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('30.00');
    expect(storedWallet.version).toBe(3);

    const transaction = await em.findOneOrFail(
        WagerTransactionEntity,
        { id: result.transactionId },
    );

    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe(
        FailureCode.ReversalWouldOverdraw,
    );

    expect(
        await em.count(WalletLedgerEntryEntity, {
        transactionId: result.transactionId,
        }),
    ).toBe(0);

    const events = await em.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    const transactionEvents = events.filter(
        (event) =>
        (event.payload.data as { transactionId?: string })
            ?.transactionId === result.transactionId,
    );

    expect(transactionEvents).toHaveLength(1);
    expect(transactionEvents[0].eventType).toBe(
        'WagerTransactionRejected',
    );
  });


});
