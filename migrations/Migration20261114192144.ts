import { Migration } from '@mikro-orm/migrations';

export class Migration20261114192144 extends Migration {

  override name = 'Migration20261114192144';

  override up(): void | Promise<void> {
    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" varchar(128) not null, "currency" varchar(3) not null, "balance" numeric(20, 2) not null default '0.00', "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`);
    this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check ("balance" >= 0);`)
  }

}
