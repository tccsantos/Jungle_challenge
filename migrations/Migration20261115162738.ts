import { Migration } from '@mikro-orm/migrations';

export class Migration20261115162738 extends Migration {

  override name = 'Migration20261115162738';

  override up(): void | Promise<void> {
    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(6) not null, "amount" numeric(20, 2) not null, "balance_before" numeric(20, 2) not null, "balance_after" numeric(20, 2) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_transaction_id_unique" unique ("wallet_id", "transaction_id");`);

    // this.addSql(`alter table "wallets" drop constraint "wallets_balance_non_negative";`);

    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);

    this.addSql(`create index "wallet_ledger_entries_wallet_history_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);

    // this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check (balance >= 0);`);
  }

}
