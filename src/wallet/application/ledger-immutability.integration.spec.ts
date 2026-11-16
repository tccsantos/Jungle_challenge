import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../mikro-orm.config.js';

import { WalletEntity } from '../entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../../wagering/entities/wager-transaction.entity.js';
import { InboxMessageEntity } from '../../messaging/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../../messaging/entities/outbox-message.entity.js';

import { WalletRepository } from '../repositories/wallet.repository.js';
import { CreateWalletUseCase } from './create-wallet.use-case.js';

describe('Wallet Ledger immutability - PostgreSQL', () => {
  let orm: MikroORM;
  let walletId: string;
  let entryId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;

    if (
      !url ||
      new URL(url).pathname !== '/jungle_processor_test'
    ) {
      throw new Error(
        'Tests require jungle_processor_test',
      );
    }

    orm = await MikroORM.init({
      ...mikroOrmConfig,
      clientUrl: url,
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

    const em = orm.em.fork();

    const createWallet = new CreateWalletUseCase(
      em,
      new WalletRepository(em),
    );

    const wallet = await createWallet.execute({
      playerId: `immutable-ledger-${randomUUID()}`,
      initialBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
    });

    walletId = wallet.id;

    const entry = await orm.em.fork().findOneOrFail(
      WalletLedgerEntryEntity,
      { wallet: walletId },
    );

    entryId = entry.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  it('rejects UPDATE of a ledger entry', async () => {
    await expect(
      orm.em.fork().execute(
        `
          UPDATE wallet_ledger_entries
          SET amount = '999.00'
          WHERE id = ?::uuid
        `,
        [entryId],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('rejects DELETE of a ledger entry', async () => {
    await expect(
      orm.em.fork().execute(
        `
          DELETE FROM wallet_ledger_entries
          WHERE id = ?::uuid
        `,
        [entryId],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('rejects TRUNCATE of the ledger table', async () => {
    await expect(
      orm.em.fork().execute(
        'TRUNCATE TABLE wallet_ledger_entries',
      ),
    ).rejects.toThrow();
  });

  it('preserves the original ledger and wallet balance', async () => {
    const em = orm.em.fork();

    const entry = await em.findOneOrFail(
      WalletLedgerEntryEntity,
      { id: entryId },
    );

    expect(entry.amount).toBe('100.00');
    expect(entry.balanceBefore).toBe('0.00');
    expect(entry.balanceAfter).toBe('100.00');

    const wallet = await em.findOneOrFail(
      WalletEntity,
      { id: walletId },
    );

    expect(wallet.balance).toBe('100.00');
    expect(wallet.version).toBe(1);
  });
});
