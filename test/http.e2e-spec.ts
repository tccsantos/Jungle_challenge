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

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { SqsService } from '../src/messaging/infrastructure/sqs.service.js';
import { OutboxPublisherWorker } from '../src/messaging/workers/outbox-publisher.worker.js';
import { PendingReferenceWorker } from '../src/wagering/workers/pending-reference.worker.js';
import { WagerCommandConsumerWorker } from '../src/wagering/workers/wager-command-consumer.worker.js';

import { WagerTransactionStatus } from '../src/wagering/domain/wager-transaction.js';

import { LedgerDirection } from '../src/wallet/domain/wallet-ledger-entry.js';


describe('HTTP API - E2E', () => {
  let app: INestApplication;

  let walletId: string;
  let transactionId: string;

  const playerId = `http-e2e-${randomUUID()}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }

    const databaseName = new URL(databaseUrl)
      .pathname.replace(/^\/+/, '');

    if (databaseName !== 'jungle_processor_test') {
      throw new Error(
        'E2E tests must use jungle_processor_test',
      );
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SqsService)
      .useValue({
        getQueueStats: vi.fn().mockResolvedValue({
          available: 0,
          inFlight: 0,
        }),
        receiveOne: vi.fn(),
        deleteMessage: vi.fn(),
        sendFifo: vi.fn(),
      })
      .overrideProvider(OutboxPublisherWorker)
      .useValue({})
      .overrideProvider(PendingReferenceWorker)
      .useValue({})
      .overrideProvider(WagerCommandConsumerWorker)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();

    await app.init();
  });

  
  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });


  it('starts the complete NestJS application', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .expect(200);

    expect(response.text).toBe('Hello World!');
  });

  it('returns database and SQS health information', async () => {
    const response = await request(app.getHttpServer())
      .get('/internal/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('connected');
    expect(response.body.outbox).toBeDefined();

    expect(response.body.sqs).toEqual({
      status: 'connected',
      commands: {
        available: 0,
        inFlight: 0,
      },
      events: {
        available: 0,
        inFlight: 0,
      },
    });
  });

  it('creates a wallet through HTTP', async () => {
    const response = await request(app.getHttpServer())
      .post('/wallets')
      .send({
        playerId,
        initialBalance: {
          amount: '100.00',
          currency: 'BRL',
        },
      })
      .expect(201);

    walletId =
      response.body.id ??
      response.body.walletId ??
      response.body.wallet?.id;

    expect(walletId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('retrieves the created wallet', async () => {
    const response = await request(app.getHttpServer())
      .get(`/wallets/${walletId}`)
      .expect(200);

    expect(response.body.id).toBe(walletId);
    expect(response.body.playerId).toBe(playerId);
    expect(response.body.balance).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });
  });

  it('reconciles a wallet individually', async () => {
    const response = await request(app.getHttpServer())
      .post(`/wallets/${walletId}/reconciliation`)
      .expect(201);

    expect(response.body).toEqual({
      walletId,
      storedBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
      calculatedBalance: {
        amount: '100.00',
        currency: 'BRL',
      },
      difference: {
        amount: '0.00',
        currency: 'BRL',
      },
      consistent: true,
      checkedEntries: 1,
    });
  });

  it('returns 404 when reconciling a nonexistent wallet', async () => {
    await request(app.getHttpServer())
      .post(
        `/wallets/${randomUUID()}/reconciliation`,
      )
      .expect(404);
  });

  it('rejects an invalid wallet ID for reconciliation', async () => {
    await request(app.getHttpServer())
      .post('/wallets/invalid-uuid/reconciliation')
      .expect(400);
  });

  it('returns 404 for a nonexistent wallet', async () => {
    await request(app.getHttpServer())
      .get(`/wallets/${randomUUID()}`)
      .expect(404);
  });

  it('returns the wallet ledger', async () => {
    const response = await request(app.getHttpServer())
      .get(`/wallets/${walletId}/ledger`)
      .query({
        limit: 10,
        offset: 0,
      })
      .expect(200);

    expect(response.body.walletId).toBe(walletId);
    expect(response.body.total).toBe(1);
    expect(response.body.entries).toHaveLength(1);

    expect(response.body.entries[0]).toMatchObject({
      direction: LedgerDirection.Credit,
      amount: '100.00',
      balanceBefore: '0.00',
      balanceAfter: '100.00',
    });

    transactionId =
      response.body.entries[0].transactionId;
  });

  it('rejects invalid ledger pagination', async () => {
    await request(app.getHttpServer())
      .get(`/wallets/${walletId}/ledger`)
      .query({ limit: 101 })
      .expect(400);

    await request(app.getHttpServer())
      .get(`/wallets/${walletId}/ledger`)
      .query({ offset: -1 })
      .expect(400);
  });

  it('lists wallet transactions', async () => {
    const response = await request(app.getHttpServer())
      .get(`/wallets/${walletId}/transactions`)
      .query({
        limit: 10,
        offset: 0,
      })
      .expect(200);

    expect(response.body.walletId).toBe(walletId);
    expect(response.body.total).toBe(1);
    expect(response.body.transactions).toHaveLength(1);

    expect(response.body.transactions[0]).toMatchObject({
      id: transactionId,
      walletId,
      status: WagerTransactionStatus.Processed,
      amount: '100.00',
      currency: 'BRL',
    });
  });

  it('retrieves a transaction by ID', async () => {
    const response = await request(app.getHttpServer())
      .get(`/wagering/transactions/${transactionId}`)
      .expect(200);

    expect(response.body.id).toBe(transactionId);
    expect(response.body.walletId).toBe(walletId);
    expect(response.body.status).toBe(WagerTransactionStatus.Processed);
  });

  it('returns 404 for a nonexistent transaction', async () => {
    await request(app.getHttpServer())
      .get(`/wagering/transactions/${randomUUID()}`)
      .expect(404);
  });

  it('reports consistent wallet balances', async () => {
    const response = await request(app.getHttpServer())
      .get('/wallets/reconciliation')
      .expect(200);

    expect(response.body.consistent).toBe(true);
    expect(response.body.inconsistentWallets).toBe(0);
  });
});
