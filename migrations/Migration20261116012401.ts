import { Migration } from '@mikro-orm/migrations';

export class Migration20261116012401 extends Migration {

  override name = 'Migration20261116012401';

  override up(): void | Promise<void> {
    // this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    // this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_positive";`);
    this.addSql(`alter table "wager_transactions" add "result_balance" numeric(20, 2) null;`);

    // this.addSql(`drop index "wallet_ledger_entries_wallet_history_idx";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop column "result_balance";`);
    // this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_positive" check (amount > 0);`);

    // this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    // this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
