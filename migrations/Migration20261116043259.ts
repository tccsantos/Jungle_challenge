import { Migration } from '@mikro-orm/migrations';

export class Migration20261116043259 extends Migration {

  override name = 'Migration20261116043259';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_positive";`);
    this.addSql(`create unique index "wager_transactions_unique_processed_reversal" on "wager_transactions" ("provider_id", "reference_transaction_id", "kind") where 
    reference_transaction_id IS NOT NULL
    AND kind IN ('REFUND', 'ROLLBACK')
    AND status = 'PROCESSED';`);

    this.addSql(`drop index "wallet_ledger_entries_wallet_history_idx";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "wager_transactions_unique_processed_reversal";`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_positive" check (amount > 0);`);

    this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
