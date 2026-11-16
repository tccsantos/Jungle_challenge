
import { Migration } from '@mikro-orm/migrations';

export class Migration20261116091126 extends Migration {
  override name = 'Migration20261116091126';

  override up(): void {
    this.addSql(`
      alter table "outbox_messages"
      add column "publish_order" bigserial;
    `);

    this.addSql(`
      create unique index "outbox_messages_publish_order_idx"
      on "outbox_messages" ("publish_order");
    `);

    this.addSql(`
      create index "outbox_messages_aggregate_order_idx"
      on "outbox_messages" ("aggregate_id", "publish_order")
      where "published_at" is null;
    `);
  }

  override down(): void {
    this.addSql(`
      drop index "outbox_messages_aggregate_order_idx";
    `);

    this.addSql(`
      drop index "outbox_messages_publish_order_idx";
    `);

    this.addSql(`
      alter table "outbox_messages"
      drop column "publish_order";
    `);
  }
}
