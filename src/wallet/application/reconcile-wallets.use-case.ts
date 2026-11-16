import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

interface ReconciliationRow {
  wallet_id: string;
  currency: string;
  stored_balance: string;
  ledger_balance: string;
  difference: string;
  is_consistent: boolean;
  checked_entries: number;
}

export interface WalletDiscrepancy {
  walletId: string;
  currency: string;
  storedBalance: string;
  ledgerBalance: string;
  difference: string;
}

export interface ReconciliationResult {
  checkedWallets: number;
  inconsistentWallets: number;
  consistent: boolean;
  discrepancies: WalletDiscrepancy[];
  checkedAt: string;
}

export interface MoneyOutput {
  amount: string;
  currency: string;
}

export interface WalletReconciliationResult {
  walletId: string;
  storedBalance: MoneyOutput;
  calculatedBalance: MoneyOutput;
  difference: MoneyOutput;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class ReconcileWalletsUseCase {
  constructor(private readonly em: EntityManager) {}

  private async query(
    walletId?: string,
  ): Promise<ReconciliationRow[]> {
    const filter = walletId
      ? 'WHERE w.id = ?::uuid'
      : '';

    return this.em.fork().execute<ReconciliationRow[]>(
      `
        WITH ledger_totals AS (
          SELECT
            wallet_id,
            SUM(
              CASE
                WHEN direction = 'CREDIT' THEN amount
                WHEN direction = 'DEBIT' THEN -amount
                ELSE 0
              END
            ) AS calculated_balance,
            COUNT(*)::int AS checked_entries
          FROM wallet_ledger_entries
          GROUP BY wallet_id
        )
        SELECT
          w.id AS wallet_id,
          w.currency,

          w.balance::numeric(20, 2)::text
            AS stored_balance,

          COALESCE(
            l.calculated_balance, 0
          )::numeric(20, 2)::text
            AS ledger_balance,

          (
            w.balance -
            COALESCE(l.calculated_balance, 0)
          )::numeric(20, 2)::text
            AS difference,

          (
            w.balance =
            COALESCE(l.calculated_balance, 0)
          ) AS is_consistent,

          COALESCE(
            l.checked_entries, 0
          )::int AS checked_entries

        FROM wallets w
        LEFT JOIN ledger_totals l
          ON l.wallet_id = w.id

        ${filter}

        ORDER BY w.id
      `,
      walletId ? [walletId] : [],
      'all',
    );
  }

  // Reconciliação global já existente.
  async execute(): Promise<ReconciliationResult> {
    const rows = await this.query();

    const discrepancies: WalletDiscrepancy[] = [];

    for (const row of rows) {
      if (row.is_consistent) {
        continue;
      }

      discrepancies.push({
        walletId: row.wallet_id,
        currency: row.currency,
        storedBalance: row.stored_balance,
        ledgerBalance: row.ledger_balance,
        difference: row.difference,
      });
    }

    return {
      checkedWallets: rows.length,
      inconsistentWallets: discrepancies.length,
      consistent: discrepancies.length === 0,
      discrepancies,
      checkedAt: new Date().toISOString(),
    };
  }

  // Nova reconciliação por carteira.
  async executeForWallet(
    walletId: string,
  ): Promise<WalletReconciliationResult | null> {
    const rows = await this.query(walletId);

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      walletId: row.wallet_id,

      storedBalance: {
        amount: row.stored_balance,
        currency: row.currency,
      },

      calculatedBalance: {
        amount: row.ledger_balance,
        currency: row.currency,
      },

      difference: {
        amount: row.difference,
        currency: row.currency,
      },

      consistent: row.is_consistent,
      checkedEntries: row.checked_entries,
    };
  }
}
