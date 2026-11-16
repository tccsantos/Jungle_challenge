import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WalletEntity } from '../entities/wallet.entity.js';

import {
  type LedgerCursor,
  encodeLedgerCursor,
} from './wallet-ledger-cursor.js';

export interface WalletLedgerHistory {
  walletId: string;
  total: number;
  limit: number;
  offset: number;
  entries: Array<{
    id: string;
    transactionId: string;
    direction: string;
    amount: string;
    balanceBefore: string;
    balanceAfter: string;
    createdAt: Date;
  }>;
}

export interface WalletLedgerCursorHistory {
  walletId: string;
  total: number;
  limit: number;
  entries: WalletLedgerHistory['entries'];
  nextCursor: string | null;
  hasMore: boolean;
}


@Injectable()
export class WalletLedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async create(
    entry: WalletLedgerEntry,
    em: EntityManager = this.em,
  ): Promise<void> {
    const entity = new WalletLedgerEntryEntity();

    entity.id = entry.id;
    entity.wallet = em.getReference(
      WalletEntity,
      entry.walletId,
    );
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.amount = entry.money.toDecimalString();
    entity.balanceBefore =
      entry.balanceBefore.toDecimalString();
    entity.balanceAfter =
      entry.balanceAfter.toDecimalString();
    entity.createdAt = entry.createdAt;

    em.persist(entity);
  }


  async findHistory(
    walletId: string,
    limit = 20,
    offset = 0,
  ): Promise<WalletLedgerHistory> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid history limit');
    }

    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('Invalid history offset');
    }

    const em = this.em.fork();

    const counts = await em.execute<Array<{ total: number }>>(
      `
        SELECT COUNT(*)::int AS total
        FROM wallet_ledger_entries
        WHERE wallet_id = ?::uuid
      `,
      [walletId],
      'all',
    );

    const rows = await em.execute<Array<{
      id: string;
      transaction_id: string;
      direction: string;
      amount: string;
      balance_before: string;
      balance_after: string;
      created_at: Date;
    }>>(
      `
        SELECT
          id,
          transaction_id,
          direction,
          amount::text AS amount,
          balance_before::text AS balance_before,
          balance_after::text AS balance_after,
          created_at
        FROM wallet_ledger_entries
        WHERE wallet_id = ?::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        OFFSET ?
      `,
      [walletId, limit, offset],
      'all',
    );

    return {
      walletId,
      total: counts[0]?.total ?? 0,
      limit,
      offset,
      entries: rows.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id,
        direction: row.direction,
        amount: row.amount,
        balanceBefore: row.balance_before,
        balanceAfter: row.balance_after,
        createdAt: row.created_at,
      })),
    };
  }

  async findHistoryByCursor(
    walletId: string,
    limit = 20,
    cursor?: LedgerCursor,
  ): Promise<WalletLedgerCursorHistory> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new Error('Invalid history limit');
    }

    const em = this.em.fork();

    const counts = await em.execute<
      Array<{ total: number }>
    >(
      `
        SELECT COUNT(*)::int AS total
        FROM wallet_ledger_entries
        WHERE wallet_id = ?::uuid
      `,
      [walletId],
      'all',
    );

    const cursorCondition = cursor
      ? `
        AND (created_at, id) <
            (?::timestamptz, ?::uuid)
      `
      : '';

    interface LedgerRow {
      id: string;
      transaction_id: string;
      direction: string;
      amount: string;
      balance_before: string;
      balance_after: string;
      created_at: Date;
      cursor_created_at: string;
    }

    const params: Array<string | number> = cursor
      ? [
          walletId,
          cursor.createdAt,
          cursor.id,
          limit + 1,
        ]
      : [walletId, limit + 1];

    const rows = await em.execute<LedgerRow[]>(
      `
        SELECT
          id,
          transaction_id,
          direction,
          amount::text AS amount,
          balance_before::text AS balance_before,
          balance_after::text AS balance_after,
          created_at,

          to_char(
            created_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS cursor_created_at

        FROM wallet_ledger_entries
        WHERE wallet_id = ?::uuid

        ${cursorCondition}

        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      params,
      'all',
    );

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);

    const nextCursor =
      hasMore && last
        ? encodeLedgerCursor({
            walletId,
            createdAt: last.cursor_created_at,
            id: last.id,
          })
        : null;

    return {
      walletId,
      total: counts[0]?.total ?? 0,
      limit,
      entries: pageRows.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id,
        direction: row.direction,
        amount: row.amount,
        balanceBefore: row.balance_before,
        balanceAfter: row.balance_after,
        createdAt: row.created_at,
      })),
      nextCursor,
      hasMore,
    };
  }

}
