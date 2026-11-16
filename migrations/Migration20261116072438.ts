import { Migration } from '@mikro-orm/migrations';

export class Migration20261116072438 extends Migration {

  override name = 'Migration20261116072438';

  override up(): void | Promise<void> {
    this.addSql(`alter table "outbox_messages" add "lease_token" uuid null, add "lease_until" timestamptz null;`);
    this.addSql(`create index "outbox_messages_lease_idx" on "outbox_messages" ("published_at", "lease_until", "next_attempt_at");`);

    // this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    // this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_positive";`);

    // this.addSql(`drop index "wallet_ledger_entries_wallet_history_idx";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "outbox_messages_lease_idx";`);
    this.addSql(`alter table "outbox_messages" drop column "lease_token", drop column "lease_until";`);

    // this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_positive" check (amount > 0);`);

    // this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    // this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
