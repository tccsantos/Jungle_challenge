import { Module } from '@nestjs/common';
import { WalletModule } from './wallet/wallet.module.js';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import mikroOrmConfig from './mikro-orm.config.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    WalletModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
