import { Migration } from '@mikro-orm/migrations';

export class Migration20261116113059 extends Migration {

  override name = 'Migration20261116113059';

  
  override up(): void {
    this.addSql(`
      CREATE OR REPLACE FUNCTION prevent_wallet_ledger_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION
          'Wallet ledger entries are immutable: % is forbidden',
          TG_OP
          USING ERRCODE = '23514';

        RETURN NULL;
      END;
      $$;
    `);

    this.addSql(`
      CREATE TRIGGER wallet_ledger_immutable_rows
      BEFORE UPDATE OR DELETE
      ON wallet_ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION prevent_wallet_ledger_mutation();
    `);

    this.addSql(`
      CREATE TRIGGER wallet_ledger_immutable_truncate
      BEFORE TRUNCATE
      ON wallet_ledger_entries
      FOR EACH STATEMENT
      EXECUTE FUNCTION prevent_wallet_ledger_mutation();
    `);
  }

  override down(): void {
    this.addSql(`
      DROP TRIGGER IF EXISTS wallet_ledger_immutable_truncate
      ON wallet_ledger_entries;
    `);

    this.addSql(`
      DROP TRIGGER IF EXISTS wallet_ledger_immutable_rows
      ON wallet_ledger_entries;
    `);

    this.addSql(`
      DROP FUNCTION IF EXISTS prevent_wallet_ledger_mutation();
    `);
  }


}
