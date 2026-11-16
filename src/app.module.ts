import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import mikroOrmConfig from './mikro-orm.config.js';

import { WalletModule } from './wallet/wallet.module.js';
import { WageringModule } from './wagering/wagering.module.js';

import { WalletEntity } from './wallet/entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from './wallet/entities/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from './wagering/entities/wager-transaction.entity.js';
import { InboxMessageEntity } from './messaging/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from './messaging/entities/outbox-message.entity.js';

@Module({
  imports: [
    MikroOrmModule.forRoot({
      ...mikroOrmConfig,
      entities: [
        WalletEntity,
        WalletLedgerEntryEntity,
        WagerTransactionEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ],
      entitiesTs: [],
    }),
    ScheduleModule.forRoot(),
    WalletModule,
    WageringModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
