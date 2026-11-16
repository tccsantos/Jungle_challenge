import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
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
import { InboxRepository } from '../../messaging/repositories/inbox.repository.js';
import { OutboxRepository } from '../../messaging/repositories/outbox.repository.js';

import { CreateWalletUseCase } from '../../wallet/application/create-wallet.use-case.js';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case.js';
import { ProcessWagerCommandUseCase } from './process-wager-command.use-case.js';
import { WagerTransactionKind } from '../domain/wager-transaction.js';

describe('Wager command atomicity - PostgreSQL', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (
      !databaseUrl ||
      new URL(databaseUrl).pathname !== '/jungle_processor_test'
    ) {
      throw new Error(
        'Tests require jungle_processor_test',
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
    if (orm) await orm.close(true);
  });

  it('rolls back inbox, wallet, ledger, transaction and outbox together', async () => {
    const em = orm.em.fork();

    const createWallet = new CreateWalletUseCase(
      em,
      new WalletRepository(em),
    );

    const wallet = await createWallet.execute({
      playerId: `atomicity-${randomUUID()}`,
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    });

    const txEm = orm.em.fork();

    const inbox = new InboxRepository(txEm);

    const processor = new ProcessWagerTransactionUseCase(
      txEm,
      new WalletRepository(txEm),
      new WagerTransactionRepository(txEm),
      new WalletLedgerRepository(txEm),
      new OutboxRepository(txEm),
    );

    const commandProcessor = new ProcessWagerCommandUseCase(
      inbox,
      processor,
      txEm,
    );

    const messageId = randomUUID();
    const externalTransactionId = randomUUID();

    const body = JSON.stringify({
      messageId,
      commandType: 'ProcessWagerTransaction',
      schemaVersion: 1,
      data: {
        providerId: 'atomicity-test',
        externalTransactionId,
        idempotencyKey: `atomicity:${externalTransactionId}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'atomicity-round',
        gameId: 'atomicity-game',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });

    // Simula uma falha depois do processamento financeiro,
    // imediatamente antes de confirmar a Inbox.
    const spy = vi.spyOn(inbox, 'markProcessed')
      .mockRejectedValueOnce(
        new Error('Injected inbox confirmation failure'),
      );

    try {
      await expect(
        commandProcessor.execute(body),
      ).rejects.toThrow(
        'Injected inbox confirmation failure',
      );
    } finally {
      spy.mockRestore();
    }

    const check = orm.em.fork();

    // A Inbox não deve ter sido confirmada nem persistida.
    expect(
      await check.count(InboxMessageEntity, {
        consumerName: 'wager-commands',
        messageId,
      }),
    ).toBe(0);

    // A BET não deve ter sido persistida.
    expect(
      await check.count(WagerTransactionEntity, {
        providerId: 'atomicity-test',
        externalTransactionId,
      }),
    ).toBe(0);

    // Apenas o crédito de abertura deve existir.
    const ledger = await check.find(
      WalletLedgerEntryEntity,
      { wallet: wallet.id },
    );

    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe('100.00');

    const storedWallet = await check.findOneOrFail(
      WalletEntity,
      { id: wallet.id },
    );

    expect(storedWallet.balance).toBe('100.00');
    expect(storedWallet.version).toBe(1);

    // Só os eventos da abertura da carteira.
    expect(
      await check.count(OutboxMessageEntity, {
        aggregateId: wallet.id,
      }),
    ).toBe(2);

    // A mesma mensagem agora pode ser reprocessada.
    const result = await commandProcessor.execute(body);
    expect(result).toBe('PROCESSED');

    const finalCheck = orm.em.fork();

    expect(
      await finalCheck.count(InboxMessageEntity, {
        consumerName: 'wager-commands',
        messageId,
        processedAt: { $ne: null },
      }),
    ).toBe(1);

    expect(
      await finalCheck.count(WagerTransactionEntity, {
        providerId: 'atomicity-test',
        externalTransactionId,
      }),
    ).toBe(1);

    const updatedWallet = await finalCheck.findOneOrFail(
      WalletEntity,
      { id: wallet.id },
    );

    expect(updatedWallet.balance).toBe('75.00');
    expect(updatedWallet.version).toBe(2);

    // Reentregar a mensagem não duplica o débito.
    expect(
      await commandProcessor.execute(body),
    ).toBe('ALREADY_PROCESSED');

    expect(
      await orm.em.fork().count(
        WalletLedgerEntryEntity,
        { wallet: wallet.id },
      ),
    ).toBe(2);
  });

  it('processes the new SQS envelope exactly once with PostgreSQL', async () => {
    // 1. Criar uma carteira exclusiva para este teste.
    const walletEm = orm.em.fork();

    const createWallet = new CreateWalletUseCase(
      walletEm,
      new WalletRepository(walletEm),
    );

    const wallet = await createWallet.execute({
      playerId: `sqs-contract-${randomUUID()}`,
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    });

    // 2. Preparar o caso de uso com repositórios reais.
    const txEm = orm.em.fork();

    const inbox = new InboxRepository(txEm);

    const processor = new ProcessWagerTransactionUseCase(
      txEm,
      new WalletRepository(txEm),
      new WagerTransactionRepository(txEm),
      new WalletLedgerRepository(txEm),
      new OutboxRepository(txEm),
    );

    const commandProcessor = new ProcessWagerCommandUseCase(
      inbox,
      processor,
      txEm,
    );

    const messageId = randomUUID();
    const externalTransactionId = randomUUID();

    // 3. Utilizar o novo envelope exigido pelo desafio.
    const body = JSON.stringify({
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'sqs-contract-test',
        externalTransactionId,
        idempotencyKey: `sqs-contract:${externalTransactionId}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'sqs-contract-round',
        gameId: 'sqs-contract-game',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '40.00',
          currency: 'BRL',
        },
      },
    });

    // Registrar o estado inicial da Outbox.
    const initialOutboxCount = await orm.em.fork().count(
      OutboxMessageEntity,
      { aggregateId: wallet.id },
    );

    // 4. Primeira entrega: processar a BET.
    const firstResult = await commandProcessor.execute(body);

    expect(firstResult).toBe('PROCESSED');

    // Utilizar um EntityManager novo para ler o estado
    // efetivamente persistido no PostgreSQL.
    const firstCheck = orm.em.fork();

    const firstWallet = await firstCheck.findOneOrFail(
      WalletEntity,
      { id: wallet.id },
    );

    expect(firstWallet.balance).toBe('60.00');
    expect(firstWallet.version).toBe(2);

    // A transação deve existir exatamente uma vez.
    expect(
      await firstCheck.count(WagerTransactionEntity, {
        providerId: 'sqs-contract-test',
        externalTransactionId,
      }),
    ).toBe(1);

    // A Inbox deve estar confirmada.
    expect(
      await firstCheck.count(InboxMessageEntity, {
        consumerName: 'wager-commands',
        messageId,
        processedAt: { $ne: null },
      }),
    ).toBe(1);

    // Um crédito inicial e um débito da BET.
    const firstLedger = await firstCheck.find(
      WalletLedgerEntryEntity,
      { wallet: wallet.id },
    );

    expect(firstLedger).toHaveLength(2);

    expect(
      firstLedger.filter(
        (entry) => entry.amount === '40.00',
      ),
    ).toHaveLength(1);

    // O processamento da BET deve acrescentar
    // somente um evento à Outbox.
    expect(
      await firstCheck.count(OutboxMessageEntity, {
        aggregateId: wallet.id,
      }),
    ).toBe(initialOutboxCount + 1);

    // 5. Simular reentrega da mesma mensagem SQS.
    // O corpo deve permanecer exatamente igual.
    const secondResult = await commandProcessor.execute(body);

    expect(secondResult).toBe('ALREADY_PROCESSED');

    // 6. Conferir novamente o PostgreSQL.
    const finalCheck = orm.em.fork();

    const finalWallet = await finalCheck.findOneOrFail(
      WalletEntity,
      { id: wallet.id },
    );

    expect(finalWallet.balance).toBe('60.00');
    expect(finalWallet.version).toBe(2);

    expect(
      await finalCheck.count(WagerTransactionEntity, {
        providerId: 'sqs-contract-test',
        externalTransactionId,
      }),
    ).toBe(1);

    expect(
      await finalCheck.count(InboxMessageEntity, {
        consumerName: 'wager-commands',
        messageId,
      }),
    ).toBe(1);

    expect(
      await finalCheck.count(WalletLedgerEntryEntity, {
        wallet: wallet.id,
      }),
    ).toBe(2);

    expect(
      await finalCheck.count(OutboxMessageEntity, {
        aggregateId: wallet.id,
      }),
    ).toBe(initialOutboxCount + 1);
  });

});
