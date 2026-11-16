import { randomUUID } from 'node:crypto';
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
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

import { RetryPendingReferencesUseCase } from './retry-pending-references.use-case.js';

import {
  MAX_REFERENCE_RETRY_ATTEMPTS,
  getReferenceRetryDelayMs,
} from './reference-retry-policy.js';

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

  function createRetryProcessor(): RetryPendingReferencesUseCase {
    const em = orm.em.fork();

    return new RetryPendingReferencesUseCase(
        em,
        new WalletRepository(em),
        new WagerTransactionRepository(em),
        new WalletLedgerRepository(em),
        new OutboxRepository(em),
    )}

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


  it('prevents two concurrent REFUNDs of the same BET', async () => {
    const wallet = await createWallet('100.00');

    const bet = betInput(wallet, '40.00');

    const betResult = await createProcessor().execute(bet);

    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
    expect(betResult.balance.amount).toBe('60.00');

    const refundA = {
        ...betInput(wallet, '40.00'),
        kind: WagerTransactionKind.Refund,
        roundId: bet.roundId,
        referenceExternalTransactionId: bet.externalTransactionId,
    };

    const refundB = {
        ...betInput(wallet, '40.00'),
        kind: WagerTransactionKind.Refund,
        roundId: bet.roundId,
        referenceExternalTransactionId: bet.externalTransactionId,
    };

    // EntityManagers distintos executam operações concorrentes
    // contra a mesma carteira no PostgreSQL.
    const [resultA, resultB] = await Promise.all([
        createProcessor().execute(refundA),
        createProcessor().execute(refundB),
    ]);

    const results = [resultA, resultB];

    expect(
        results.filter((result) => result.status === WagerTransactionStatus.Processed),
    ).toHaveLength(1);

    expect(
        results.filter((result) => result.status === WagerTransactionStatus.Rejected),
    ).toHaveLength(1);

    const rejected = results.find(
        (result) => result.status === WagerTransactionStatus.Rejected,
    );

    expect(rejected?.failureCode).toBe(FailureCode.InvalidReference);

    const em = orm.em.fork();

    const storedWallet = await em.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('100.00');
    expect(storedWallet.version).toBe(3);

    const refunds = await em.find(
        WagerTransactionEntity,
        {
        wallet: wallet.id,
        kind: WagerTransactionKind.Refund,
        },
    );

    expect(refunds).toHaveLength(2);

    expect(
        refunds.filter((transaction) =>
        transaction.status === WagerTransactionStatus.Processed
        ),
    ).toHaveLength(1);

    expect(
        refunds.filter((transaction) =>
        transaction.status === WagerTransactionStatus.Rejected
        ),
    ).toHaveLength(1);

    const ledger = await em.find(
        WalletLedgerEntryEntity,
        { wallet: wallet.id },
    );

    // OPENING = CREDIT
    // BET = DEBIT
    // Um único REFUND = CREDIT
    expect(ledger).toHaveLength(3);

    expect(
        ledger.filter((entry) =>
        entry.direction === LedgerDirection.Credit
        ),
    ).toHaveLength(2);

    const processedRefund = refunds.find(
        (transaction) => transaction.status === WagerTransactionStatus.Processed,
    );

    const refundLedger = ledger.filter(
        (entry) => entry.transactionId === processedRefund?.id,
    );

    expect(refundLedger).toHaveLength(1);
    expect(refundLedger[0].amount).toBe('40.00');
  });


  describe('RetryPendingReferencesUseCase', () => {
    function reversalInput(
        wallet: Parameters<typeof betInput>[0],
        amount: string,
        kind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
        reference: ReturnType<typeof betInput>,
    ) {
        return {
        ...betInput(wallet, amount),
        kind,
        roundId: reference.roundId,
        gameId: reference.gameId,
        referenceExternalTransactionId:
            reference.externalTransactionId,
        };
    }

    it('processes a pending REFUND after its BET arrives', async () => {
        const wallet = await createWallet('100.00');
        const processor = createProcessor();

        const bet = betInput(wallet, '40.00');

        const refund = reversalInput(
        wallet,
        '40.00',
        WagerTransactionKind.Refund,
        bet,
        );

        const pending = await processor.execute(refund);

        expect(pending.status).toBe(
            WagerTransactionStatus.PendingReference,
        );
        expect(pending.balance.amount).toBe('100.00');

        const betResult = await processor.execute(bet);

        expect(betResult.status).toBe(
            WagerTransactionStatus.Processed,
        );
        expect(betResult.balance.amount).toBe('60.00');

        const worker = createRetryProcessor();

        const result = await worker.execute();

        expect(result.processed).toBeGreaterThanOrEqual(1);

        const em = orm.em.fork();

        const transaction = await em.findOneOrFail(
            WagerTransactionEntity,
            { id: pending.transactionId },
        );

        expect(transaction.status).toBe(
            WagerTransactionStatus.Processed,
        );
        expect(transaction.referenceTransaction?.id).toBe(
            betResult.transactionId,
        );

        const ledger = await em.find(
            WalletLedgerEntryEntity,
            { transactionId: pending.transactionId },
        );

        expect(ledger).toHaveLength(1);
        expect(ledger[0].direction).toBe(
            LedgerDirection.Credit,
        );
        expect(ledger[0].amount).toBe('40.00');

        const storedWallet = await em.findOneOrFail(
            WalletEntity,
            { id: wallet.id },
        );

        expect(storedWallet.balance).toBe('100.00');
        expect(storedWallet.version).toBe(3);

        // Reexecução do worker não altera o saldo.
        const secondRun = await worker.execute();

        expect(secondRun.processed).toBe(0);

        // Replay HTTP preserva o ID e devolve o novo resultado.
        const replay = await processor.execute(refund);

        expect(replay.idempotentReplay).toBe(true);
        expect(replay.transactionId).toBe(pending.transactionId);
        expect(replay.status).toBe(
            WagerTransactionStatus.Processed,
        );
        expect(replay.balance.amount).toBe('100.00');
    });

    it('processes a pending ROLLBACK after its WIN arrives', async () => {
        const wallet = await createWallet('100.00');
        const processor = createProcessor();

        const win = {
            ...betInput(wallet, '40.00'),
            kind: WagerTransactionKind.Win,
        };

        const rollback = reversalInput(
            wallet,
            '40.00',
            WagerTransactionKind.Rollback,
            win,
        );

        const pending = await processor.execute(rollback);

        expect(pending.status).toBe(
            WagerTransactionStatus.PendingReference,
        );

        const winResult = await processor.execute(win);

        expect(winResult.balance.amount).toBe('140.00');

        const result = await createRetryProcessor().execute();

        expect(result.processed).toBe(1);

        const em = orm.em.fork();

        const transaction = await em.findOneOrFail(
            WagerTransactionEntity,
            { id: pending.transactionId },
        );

        expect(transaction.status).toBe(
            WagerTransactionStatus.Processed,
        );
        expect(transaction.referenceTransaction?.id).toBe(
            winResult.transactionId,
        );

        const ledger = await em.find(
            WalletLedgerEntryEntity,
            { transactionId: pending.transactionId },
        );

        expect(ledger).toHaveLength(1);
        expect(ledger[0].direction).toBe(
            LedgerDirection.Debit,
        );
        expect(ledger[0].amount).toBe('40.00');

        const storedWallet = await em.findOneOrFail(
            WalletEntity,
            { id: wallet.id },
        );

        expect(storedWallet.balance).toBe('100.00');
        expect(storedWallet.version).toBe(3);
    });

    it('reschedules when the reference is still missing', async () => {
        const wallet = await createWallet('100.00');
        const processor = createProcessor();

        const missingBet = betInput(wallet, '40.00');

        const refund = reversalInput(
        wallet,
        '40.00',
        WagerTransactionKind.Refund,
        missingBet,
        );

        const pending = await processor.execute(refund);

        const before = Date.now();

        const result = await createRetryProcessor().execute();

        const after = Date.now();

        expect(result.rescheduled).toBe(1);
        expect(result.processed).toBe(0);

        const em = orm.em.fork();

        const transaction = await em.findOneOrFail(
            WagerTransactionEntity,
            { id: pending.transactionId },
        );

        expect(transaction.status).toBe(
            WagerTransactionStatus.PendingReference,
        );
        expect(transaction.referenceRetryAttempts).toBe(1);

        const nextRetryAt = transaction.referenceNextRetryAt;

        expect(nextRetryAt).toBeDefined();

        const expectedDelay = getReferenceRetryDelayMs(1);

        expect(nextRetryAt!.getTime()).toBeGreaterThanOrEqual(
            before + expectedDelay,
        );
        expect(nextRetryAt!.getTime()).toBeLessThanOrEqual(
            after + expectedDelay,
        );

        // Ainda não chegou o próximo horário.
        const secondRun = await createRetryProcessor().execute();

        expect(secondRun.processed).toBe(0);
        expect(secondRun.rescheduled).toBe(0);

        expect(
            await em.count(WalletLedgerEntryEntity, {
                transactionId: pending.transactionId,
            }),
        ).toBe(0);
    });

    it('rejects a pending reference after the retry limit', async () => {
        const wallet = await createWallet('100.00');
        const processor = createProcessor();

        const missingBet = betInput(wallet, '40.00');

        const refund = reversalInput(
            wallet,
            '40.00',
            WagerTransactionKind.Refund,
            missingBet,
        );

        const pending = await processor.execute(refund);

        const worker = createRetryProcessor();

        for (
            let attempt = 1;
            attempt <= MAX_REFERENCE_RETRY_ATTEMPTS;
            attempt++
        ) {
            // Antecipamos o horário usando o banco de testes,
            // sem esperar vários segundos entre as tentativas.
            await orm.em.fork().nativeUpdate(
                WagerTransactionEntity,
                { id: pending.transactionId },
                {
                    referenceNextRetryAt: new Date(
                        Date.now() - 1000,
                    ),
                },
            );

            const result = await worker.execute();

            if (attempt < MAX_REFERENCE_RETRY_ATTEMPTS) {
                expect(result.rescheduled).toBe(1);
            } else {
                expect(result.rejected).toBe(1);
            }
        }

        const em = orm.em.fork();

        const transaction = await em.findOneOrFail(
            WagerTransactionEntity,
            { id: pending.transactionId },
        );

        expect(transaction.status).toBe(
            WagerTransactionStatus.Rejected,
        );
        expect(transaction.failureCode).toBe(
            FailureCode.ReferenceNotFound,
        );

        expect(transaction.referenceRetryAttempts).toBe(
            MAX_REFERENCE_RETRY_ATTEMPTS,
        );

        expect(transaction.referenceRetryAttempts).toBe(5);


        expect(
            await em.count(WalletLedgerEntryEntity, {
                transactionId: pending.transactionId,
            }),
        ).toBe(0);

        const storedWallet = await em.findOneOrFail(
            WalletEntity,
            { id: wallet.id },
        );

        expect(storedWallet.balance).toBe('100.00');

        const replay = await processor.execute(refund);

        expect(replay.idempotentReplay).toBe(true);
        expect(replay.status).toBe(
            WagerTransactionStatus.Rejected,
        );
        expect(replay.failureCode).toBe(
            FailureCode.ReferenceNotFound,
        );
    });

    it('rejects a pending REFUND with an incompatible reference', async () => {
        const wallet = await createWallet('100.00');
        const processor = createProcessor();

        const win = {
            ...betInput(wallet, '40.00'),
            kind: WagerTransactionKind.Win,
        };

        // REFUND exige referência a uma BET,
        // não a uma WIN.
        const refund = reversalInput(
            wallet,
            '40.00',
            WagerTransactionKind.Refund,
            win,
        );

        const pending = await processor.execute(refund);

        expect(pending.status).toBe(
            WagerTransactionStatus.PendingReference,
        );

        await processor.execute(win);

        const result = await createRetryProcessor().execute();

        expect(result.rejected).toBe(1);

        const em = orm.em.fork();

        const transaction = await em.findOneOrFail(
            WagerTransactionEntity,
            { id: pending.transactionId },
        );

        expect(transaction.status).toBe(
            WagerTransactionStatus.Rejected,
        );
        expect(transaction.failureCode).toBe(
            FailureCode.InvalidReference,
        );

        expect(
            await em.count(WalletLedgerEntryEntity, {
                transactionId: pending.transactionId,
            }),
        ).toBe(0);

        const storedWallet = await em.findOneOrFail(
            WalletEntity,
            { id: wallet.id },
        );

        // Somente a WIN alterou o saldo.
        expect(storedWallet.balance).toBe('140.00');
        expect(storedWallet.version).toBe(2);
    });

    it('rejects a pending REFUND if another REFUND was already processed', async () => {
        const wallet = await createWallet('100.00');
        const processor = createProcessor();

        const bet = betInput(wallet, '40.00');

        const pendingRefund = reversalInput(
            wallet,
            '40.00',
            WagerTransactionKind.Refund,
            bet,
        );

        const pending = await processor.execute(pendingRefund);

        await processor.execute(bet);

        // Um outro REFUND é processado antes do worker.
        const immediateRefund = reversalInput(
            wallet,
            '40.00',
            WagerTransactionKind.Refund,
            bet,
        );

        const immediate = await processor.execute(immediateRefund);

        expect(immediate.status).toBe(
            WagerTransactionStatus.Processed,
        );

        const result = await createRetryProcessor().execute();

        expect(result.rejected).toBe(1);

        const em = orm.em.fork();

        const transaction = await em.findOneOrFail(
            WagerTransactionEntity,
            { id: pending.transactionId },
        );

        expect(transaction.status).toBe(
            WagerTransactionStatus.Rejected,
        );
        expect(transaction.failureCode).toBe(
            FailureCode.InvalidReference,
        );

        const storedWallet = await em.findOneOrFail(
            WalletEntity,
            { id: wallet.id },
        );

        expect(storedWallet.balance).toBe('100.00');
        expect(storedWallet.version).toBe(3);

        expect(
            await em.count(WalletLedgerEntryEntity, {
                transactionId: pending.transactionId,
            }),
        ).toBe(0);
    });

    it('rejects a pending ROLLBACK that would overdraw the wallet', async () => {
        const wallet = await createWallet('100.00');
        const processor = createProcessor();

        const win = {
            ...betInput(wallet, '80.00'),
            kind: WagerTransactionKind.Win,
        };

        const rollback = reversalInput(
            wallet,
            '80.00',
            WagerTransactionKind.Rollback,
            win,
        );

        const pending = await processor.execute(rollback);

        expect(pending.status).toBe(
            WagerTransactionStatus.PendingReference,
        );

        const winResult = await processor.execute(win);

        expect(winResult.balance.amount).toBe('180.00');

        const betResult = await processor.execute(
            betInput(wallet, '150.00'),
        );

        expect(betResult.balance.amount).toBe('30.00');

        const result = await createRetryProcessor().execute();

        expect(result.rejected).toBe(1);

        const em = orm.em.fork();

        const transaction = await em.findOneOrFail(
            WagerTransactionEntity,
            { id: pending.transactionId },
        );

        expect(transaction.status).toBe(
            WagerTransactionStatus.Rejected,
        );
        expect(transaction.failureCode).toBe(
            FailureCode.ReversalWouldOverdraw,
        );

        const storedWallet = await em.findOneOrFail(
            WalletEntity,
            { id: wallet.id },
        );

        expect(storedWallet.balance).toBe('30.00');
        expect(storedWallet.version).toBe(3);

        expect(
            await em.count(WalletLedgerEntryEntity, {
                transactionId: pending.transactionId,
            }),
        ).toBe(0);
    });

    it('allows only one worker to process the same pending REFUND', async () => {
        const wallet = await createWallet('100.00');
        const processor = createProcessor();

        const bet = betInput(wallet, '40.00');

        const refund = reversalInput(
            wallet,
            '40.00',
            WagerTransactionKind.Refund,
            bet,
        );

        const pending = await processor.execute(refund);

        await processor.execute(bet);

        // Dois workers com EntityManagers independentes.
        const [first, second] = await Promise.all([
            createRetryProcessor().execute(),
            createRetryProcessor().execute(),
        ]);

        expect(first.processed + second.processed).toBe(1);
        expect(first.rejected + second.rejected).toBe(0);

        const em = orm.em.fork();

        const transaction = await em.findOneOrFail(
            WagerTransactionEntity,
            { id: pending.transactionId },
        );

        expect(transaction.status).toBe(
            WagerTransactionStatus.Processed,
        );

        const walletAfter = await em.findOneOrFail(
            WalletEntity,
            { id: wallet.id },
        );

        expect(walletAfter.balance).toBe('100.00');
        expect(walletAfter.version).toBe(3);

        const ledger = await em.find(
            WalletLedgerEntryEntity,
            { transactionId: pending.transactionId },
        );

        expect(ledger).toHaveLength(1);
        expect(ledger[0].direction).toBe(
            LedgerDirection.Credit,
        );
        expect(ledger[0].amount).toBe('40.00');

        // Nenhum processamento adicional.
        const third = await createRetryProcessor().execute();

        expect(third.processed).toBe(0);
    });
  });
  

  it('rolls back a REFUND when ledger persistence fails', async () => {
    const wallet = await createWallet('100.00');

    const bet = betInput(wallet, '40.00');
    const betResult = await createProcessor().execute(bet);

    expect(betResult.status).toBe(
        WagerTransactionStatus.Processed,
    );
    expect(betResult.balance.amount).toBe('60.00');

    const refund = {
        ...betInput(wallet, '40.00'),
        kind: WagerTransactionKind.Refund,
        roundId: bet.roundId,
        gameId: bet.gameId,
        referenceExternalTransactionId:
        bet.externalTransactionId,
    };

    const em = orm.em.fork();

    const walletRepository = new WalletRepository(em);
    const transactionRepository = new WagerTransactionRepository(em);
    const ledgerRepository = new WalletLedgerRepository(em);
    const outboxRepository = new OutboxRepository(em);

    vi.spyOn(ledgerRepository, 'create').mockRejectedValueOnce(
        new Error('Simulated ledger persistence failure'),
    );

    const processor = new ProcessWagerTransactionUseCase(
        em,
        walletRepository,
        transactionRepository,
        ledgerRepository,
        outboxRepository,
    );

    await expect(
        processor.execute(refund),
    ).rejects.toThrow('Simulated ledger persistence failure');

    // Consultar usando um EntityManager novo para verificar
    // o estado realmente persistido após o rollback.
    const check = orm.em.fork();

    const storedWallet = await check.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('60.00');
    expect(storedWallet.version).toBe(2);

    const storedRefund = await check.findOne(
        WagerTransactionEntity,
        {
        providerId: refund.providerId,
        externalTransactionId: refund.externalTransactionId,
        },
    );

    expect(storedRefund).toBeNull();


    const orphanEvents = await check.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    const refundEvents = orphanEvents.filter((event) => {
        const payload = event.payload as {
            data?: {
                externalTransactionId?: string;
            };
        };

        return (
            payload.data?.externalTransactionId ===
            refund.externalTransactionId
        );
    });

    expect(refundEvents).toHaveLength(0);


    // A ausência da transação confirma que a operação
    // pode ser recebida novamente com a mesma identidade.
    const retry = await createProcessor().execute(refund);

    expect(retry.status).toBe(
        WagerTransactionStatus.Processed,
    );
    expect(retry.balance.amount).toBe('100.00');

    const finalCheck = orm.em.fork();

    expect(
        await finalCheck.count(WalletLedgerEntryEntity, {
        transactionId: retry.transactionId,
        }),
    ).toBe(1);

    const finalWallet = await finalCheck.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(finalWallet.balance).toBe('100.00');
    expect(finalWallet.version).toBe(3);

    const eventCheck = orm.em.fork();

    const persistedEvents = await eventCheck.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    const successfulRefundEvents = persistedEvents.filter((event) => {
        const payload = event.payload as {
            data?: {
            transactionId?: string;
            };
        };

        return payload.data?.transactionId === retry.transactionId;
    });

    expect(successfulRefundEvents).toHaveLength(2);

    expect(
        successfulRefundEvents.map((event) => event.eventType).sort(),
    ).toEqual([
        'WagerTransactionProcessed',
        'WalletBalanceChanged',
    ].sort());

  });

  it('rolls back a REFUND when outbox persistence fails', async () => {
    const wallet = await createWallet('100.00');

    const bet = betInput(wallet, '40.00');
    const betResult = await createProcessor().execute(bet);

    expect(betResult.status).toBe(
        WagerTransactionStatus.Processed,
    );

    const refund = {
        ...betInput(wallet, '40.00'),
        kind: WagerTransactionKind.Refund,
        roundId: bet.roundId,
        gameId: bet.gameId,
        referenceExternalTransactionId:
        bet.externalTransactionId,
    };

    const em = orm.em.fork();

    const walletRepository = new WalletRepository(em);
    const transactionRepository = new WagerTransactionRepository(em);
    const ledgerRepository = new WalletLedgerRepository(em);
    const outboxRepository = new OutboxRepository(em);

    const originalCreate =
        outboxRepository.create.bind(outboxRepository);

    let calls = 0;

    // A primeira chamada registra WagerTransactionProcessed.
    // A segunda, WalletBalanceChanged, falhará.
    vi.spyOn(outboxRepository, 'create').mockImplementation(
        async (...args) => {
        calls++;

        if (calls === 2) {
            throw new Error(
            'Simulated outbox persistence failure',
            );
        }

        return originalCreate(...args);
        },
    );

    const processor = new ProcessWagerTransactionUseCase(
        em,
        walletRepository,
        transactionRepository,
        ledgerRepository,
        outboxRepository,
    );

    await expect(
        processor.execute(refund),
    ).rejects.toThrow(
        'Simulated outbox persistence failure',
    );

    expect(calls).toBe(2);

    const check = orm.em.fork();

    const storedWallet = await check.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('60.00');
    expect(storedWallet.version).toBe(2);

    const storedRefund = await check.findOne(
        WagerTransactionEntity,
        {
        providerId: refund.providerId,
        externalTransactionId: refund.externalTransactionId,
        },
    );

    expect(storedRefund).toBeNull();

    const orphanEvents = await check.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    const refundEvents = orphanEvents.filter((event) => {
        const payload = event.payload as {
            data?: {
                externalTransactionId?: string;
            };
        };

        return (
            payload.data?.externalTransactionId ===
            refund.externalTransactionId
        );
    });

    expect(refundEvents).toHaveLength(0);

    // Nenhum REFUND ficou persistido.
    // Reenviar a mesma operação deve funcionar normalmente.
    const retry = await createProcessor().execute(refund);

    expect(retry.status).toBe(
        WagerTransactionStatus.Processed,
    );
    expect(retry.balance.amount).toBe('100.00');

    const finalCheck = orm.em.fork();

    const ledger = await finalCheck.find(
        WalletLedgerEntryEntity,
        { transactionId: retry.transactionId },
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0].direction).toBe(
        LedgerDirection.Credit,
    );

    const finalWallet = await finalCheck.findOneOrFail(
        WalletEntity,
        { id: wallet.id },
    );

    expect(finalWallet.balance).toBe('100.00');
    expect(finalWallet.version).toBe(3);


    const eventCheck = orm.em.fork();

    const persistedEvents = await eventCheck.find(
        OutboxMessageEntity,
        { aggregateId: wallet.id },
    );

    const successfulRefundEvents = persistedEvents.filter((event) => {
        const payload = event.payload as {
            data?: {
            transactionId?: string;
            };
        };

        return payload.data?.transactionId === retry.transactionId;
    });

    expect(successfulRefundEvents).toHaveLength(2);

    expect(
        successfulRefundEvents.map((event) => event.eventType).sort(),
    ).toEqual([
        'WagerTransactionProcessed',
        'WalletBalanceChanged',
    ].sort());

  });


  describe('OutboxRepository - PostgreSQL', () => {


    const createdOutboxIds: string[] = [];

    afterEach(async () => {
    const em = orm.em.fork();

    for (const id of createdOutboxIds) {
        await em.execute(
        'DELETE FROM outbox_messages WHERE id = ?::uuid',
        [id],
        );
    }

    createdOutboxIds.length = 0;
    });


    async function createOutboxMessage(
        aggregateId: string,
        occurredAt = new Date('2000-01-01T00:00:00.000Z'),
    ): Promise<string> {
        const id = randomUUID();
        const em = orm.em.fork();

        const entity = new OutboxMessageEntity();

        entity.id = id;
        entity.aggregateId = aggregateId;
        entity.eventType = 'WagerTransactionProcessed';
        entity.occurredAt = occurredAt;
        entity.attempts = 0;
        entity.payload = {
        eventId: id,
        aggregateId,
        eventType: entity.eventType,
        occurredAt: occurredAt.toISOString(),
        data: {
            transactionId: randomUUID(),
        },
        };

        em.persist(entity);
        await em.flush();
        createdOutboxIds.push(id);

        return id;
    }

    it('claims a pending message and confirms publication', async () => {
        const id = await createOutboxMessage(randomUUID());

        const repository = new OutboxRepository(orm.em.fork());
        const claimed = await repository.claimPending(100);

        const item = claimed.find(
        (candidate) => candidate.message.id === id,
        );

        expect(item).toBeDefined();

        const confirmed =
        await repository.confirmPublished(item!);

        expect(confirmed).toBe(true);

        const em = orm.em.fork();
        const stored = await em.findOneOrFail(
        OutboxMessageEntity,
        { id },
        );

        expect(stored.publishedAt).toBeDefined();
        expect(stored.leaseToken).toBeNull();
        expect(stored.leaseUntil).toBeNull();

        // Uma segunda confirmação não deve alterar o evento.
        expect(
        await repository.confirmPublished(item!),
        ).toBe(false);

        const finalCheck = orm.em.fork();

        expect(
        (await finalCheck.findOneOrFail(
            OutboxMessageEntity,
            { id },
        )).publishedAt,
        ).toBeDefined();
    });

    it('does not allow two publishers to claim the same message', async () => {
        const id = await createOutboxMessage(randomUUID());

        const firstRepository =
        new OutboxRepository(orm.em.fork());

        const secondRepository =
        new OutboxRepository(orm.em.fork());

        const [first, second] = await Promise.all([
        firstRepository.claimPending(100),
        secondRepository.claimPending(100),
        ]);

        const claimedCount = [...first, ...second].filter(
        (item) => item.message.id === id,
        ).length;

        expect(claimedCount).toBe(1);
    });

    it('recovers a message after its lease expires', async () => {
        const id = await createOutboxMessage(randomUUID());

        const repository = new OutboxRepository(orm.em.fork());

        const initialClaim = await repository.claimPending(100);

        const original = initialClaim.find(
        (item) => item.message.id === id,
        );

        expect(original).toBeDefined();

        // Simula expiração do lease de um publisher
        // que caiu antes de confirmar a publicação.
        await orm.em.fork().nativeUpdate(
        OutboxMessageEntity,
        { id },
        {
            leaseUntil: new Date(Date.now() - 1000),
        },
        );

        const recovered = await new OutboxRepository(
        orm.em.fork(),
        ).claimPending(100);

        const reclaimed = recovered.find(
        (item) => item.message.id === id,
        );

        expect(reclaimed).toBeDefined();

        expect(reclaimed!.leaseToken).not.toBe(
        original!.leaseToken,
        );

        // O publisher antigo perdeu a autorização.
        const oldConfirmation =
        await repository.confirmPublished(original!);

        expect(oldConfirmation).toBe(false);

        // O novo publisher consegue confirmar.
        const newConfirmation =
        await repository.confirmPublished(reclaimed!);

        expect(newConfirmation).toBe(true);
    });


    it('persists retry and makes the message available again when due', async () => {
        const id = await createOutboxMessage(
            randomUUID(),
            new Date('1990-01-01T00:00:00.000Z'),
        );

        const repository = new OutboxRepository(orm.em.fork());

        const firstBatch = await repository.claimPending(100);
        const claimed = firstBatch.find(
            (item) => item.message.id === id,
        );

        expect(claimed).toBeDefined();

        const scheduled = await repository.schedulePublishRetry(
            claimed!,
        );

        expect(scheduled).toBe(true);

        const stored = await orm.em.fork().findOneOrFail(
            OutboxMessageEntity,
            { id },
        );

        expect(stored.attempts).toBe(1);
        expect(stored.nextAttemptAt).toBeDefined();
        expect(stored.nextAttemptAt!.getTime()).toBeGreaterThan(
            Date.now(),
        );
        expect(stored.leaseToken).toBeNull();
        expect(stored.leaseUntil).toBeNull();
        expect(stored.publishedAt).toBeNull();

        // Ainda não chegou a hora da próxima tentativa.
        const earlyBatch = await repository.claimPending(100);

        expect(
            earlyBatch.some((item) => item.message.id === id),
        ).toBe(false);

        // Simula a passagem do tempo.
        await orm.em.fork().nativeUpdate(
            OutboxMessageEntity,
            { id },
            {
            nextAttemptAt: new Date(Date.now() - 1_000),
            },
        );

        const retryBatch = await repository.claimPending(100);

        const retried = retryBatch.find(
            (item) => item.message.id === id,
        );

        expect(retried).toBeDefined();
        expect(retried!.message.attempts).toBe(1);

        expect(
            await repository.confirmPublished(retried!),
        ).toBe(true);

        const finalState = await orm.em.fork().findOneOrFail(
            OutboxMessageEntity,
            { id },
        );

        expect(finalState.publishedAt).toBeDefined();
        expect(finalState.nextAttemptAt).toBeNull();
        expect(finalState.attempts).toBe(1);
    });


    it('does not claim a later event from the same wallet before the previous one is published', async () => {
        const aggregateId = randomUUID();

        const firstId = await createOutboxMessage(
            aggregateId,
            new Date('1990-01-02T00:00:00.000Z'),
        );

        const secondId = await createOutboxMessage(
            aggregateId,
            new Date('1990-01-02T00:00:01.000Z'),
        );

        const repository = new OutboxRepository(orm.em.fork());

        const firstBatch = await repository.claimPending(100);

        const first = firstBatch.find(
            (item) => item.message.id === firstId,
        );

        expect(first).toBeDefined();

        // O primeiro evento continua reservado e não publicado.
        // O segundo não pode ultrapassá-lo.
        const blockedBatch = await new OutboxRepository(
            orm.em.fork(),
        ).claimPending(100);

        expect(
            blockedBatch.some(
            (item) => item.message.id === secondId,
            ),
        ).toBe(false);

        expect(
            await repository.confirmPublished(first!),
        ).toBe(true);

        // Somente depois da confirmação do primeiro,
        // o segundo evento torna-se elegível.
        const secondBatch = await repository.claimPending(100);

        const second = secondBatch.find(
            (item) => item.message.id === secondId,
        );

        expect(second).toBeDefined();

        expect(
            await repository.confirmPublished(second!),
        ).toBe(true);
    });


  });


});
