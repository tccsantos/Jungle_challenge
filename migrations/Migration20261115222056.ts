import { Migration } from '@mikro-orm/migrations';

export class Migration20261115222056 extends Migration {

  override name = 'Migration20261115222056';

  override up(): void | Promise<void> {
    this.addSql(`create table "outbox_messages" ("id" uuid not null, "aggregate_id" varchar(255) not null, "event_type" varchar(128) not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null default 0, "next_attempt_at" timestamptz null, "published_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "outbox_messages_pending_idx" on "outbox_messages" ("published_at", "next_attempt_at", "occurred_at");`);

    // this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    // this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_provider_id_idempotency_key_unique";`);
    // this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_positive";`);
    // this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);

    // this.addSql(`drop index "wallet_ledger_entries_wallet_history_idx";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "outbox_messages" cascade;`);

    // this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_idempotency_key_unique";`);
    // this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_idempotency_key_unique" unique ("provider_id", "idempotency_key");`);
    // this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_positive" check (amount > 0);`);

    // this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    // this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
