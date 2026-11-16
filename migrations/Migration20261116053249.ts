import { Migration } from '@mikro-orm/migrations';

export class Migration20261116053249 extends Migration {

  override name = 'Migration20261116053249';

  override up(): void | Promise<void> {
    // this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    // this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_positive";`);
    this.addSql(`create index "wager_transactions_reference_retry_idx" on "wager_transactions" ("status", "reference_next_retry_at");`);

    // this.addSql(`drop index "wallet_ledger_entries_wallet_history_idx";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "wager_transactions_reference_retry_idx";`);
    // this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_positive" check (amount > 0);`);

    // this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    // this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
