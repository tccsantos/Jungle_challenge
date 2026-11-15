import { Migration } from '@mikro-orm/migrations';

export class Migration20261115184726 extends Migration {

  override name = 'Migration20261115184726';

  override up(): void | Promise<void> {
    this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(128) not null, "external_transaction_id" varchar(128) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(64) not null, "wallet_id" uuid not null, "player_id" varchar(128) not null, "round_id" varchar(128) not null, "game_id" varchar(128) not null, "kind" varchar(16) not null, "status" varchar(24) not null default 'PENDING', "amount" numeric(20, 2) not null, "currency" varchar(3) not null, "reference_external_transaction_id" varchar(128) null, "reference_transaction_id" uuid null, "failure_code" varchar(64) null, "created_at" timestamptz not null, "processed_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "wager_transactions_provider_id_reference_external__48426_index" on "wager_transactions" ("provider_id", "reference_external_transaction_id");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`);

    this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    this.addSql(`drop index "wallet_ledger_entries_wallet_history_idx";`);

    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_reference_transaction_id_foreign" foreign key ("reference_transaction_id") references "wager_transactions" ("id") on delete restrict;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_reference_transaction_id_foreign";`);

    this.addSql(`drop table if exists "wager_transactions" cascade;`);

    this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);

    this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
