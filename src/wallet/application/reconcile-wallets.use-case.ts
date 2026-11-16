import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

interface ReconciliationRow {
  wallet_id: string;
  currency: string;
  stored_balance: string;
  ledger_balance: string;
  difference: string;
  is_consistent: boolean;
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

@Injectable()
export class ReconcileWalletsUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(): Promise<ReconciliationResult> {
    const rows = await this.em.fork().execute<
      ReconciliationRow[]
    >(
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
            ) AS calculated_balance
          FROM wallet_ledger_entries
          GROUP BY wallet_id
        )
        SELECT
          w.id AS wallet_id,
          w.currency,
          w.balance::text AS stored_balance,
          COALESCE(
            l.calculated_balance, 0
          )::text AS ledger_balance,
          (
            w.balance -
            COALESCE(l.calculated_balance, 0)
          )::text AS difference,
          (
            w.balance = COALESCE(l.calculated_balance, 0)
          ) AS is_consistent
        FROM wallets w
        LEFT JOIN ledger_totals l
          ON l.wallet_id = w.id
        ORDER BY w.id
      `,
      [],
      'all',
    );

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
}
