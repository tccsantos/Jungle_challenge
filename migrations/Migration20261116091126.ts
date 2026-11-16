import { Migration } from '@mikro-orm/migrations';

export class Migration20261116091126 extends Migration {

  override name = 'Migration20261116091126';

  override up(): void | Promise<void> {
    this.addSql(`drop index "outbox_messages_pending_idx";`);
    this.addSql(`alter table "outbox_messages" add "publish_order" bigserial;`);
    this.addSql(`create index "outbox_messages_aggregate_order_idx" on "outbox_messages" ("aggregate_id", "publish_order") where "published_at" is null;`);
    this.addSql(`create index "outbox_messages_publish_order_idx" on "outbox_messages" ("publish_order");`);
    this.addSql(`alter table "outbox_messages" add constraint "outbox_messages_pending_idx" unique ("published_at", "next_attempt_at", "occurred_at");`);

    this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_positive";`);

    this.addSql(`drop index "wallet_ledger_entries_wallet_history_idx";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "outbox_messages_aggregate_order_idx";`);
    this.addSql(`drop index "outbox_messages_publish_order_idx";`);
    this.addSql(`alter table "outbox_messages" drop constraint "outbox_messages_pending_idx";`);
    this.addSql(`alter table "outbox_messages" drop column "publish_order";`);
    this.addSql(`create index "outbox_messages_pending_idx" on "outbox_messages" ("published_at", "next_attempt_at", "occurred_at");`);

    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_positive" check (amount > 0);`);

    this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
