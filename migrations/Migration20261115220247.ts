import { Migration } from '@mikro-orm/migrations';

export class Migration20261115220247 extends Migration {

  override name = 'Migration20261115220247';

  override up(): void | Promise<void> {
    this.addSql(`create table "inbox_messages" ("id" uuid not null, "message_id" varchar(255) not null, "consumer_name" varchar(128) not null, "payload_hash" varchar(64) not null, "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "inbox_messages" add constraint "inbox_messages_consumer_name_message_id_unique" unique ("consumer_name", "message_id");`);

    this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_provider_id_idempotency_key_unique";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_positive";`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);

    this.addSql(`drop index "wallet_ledger_entries_wallet_history_idx";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "inbox_messages" cascade;`);

    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_idempotency_key_unique";`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_idempotency_key_unique" unique ("provider_id", "idempotency_key");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_positive" check (amount > 0);`);

    this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
