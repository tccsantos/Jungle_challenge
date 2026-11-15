import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { WalletEntity } from './entities/wallet.entity.js';
import { WalletRepository } from './repositories/wallet.repository.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([WalletEntity]),
  ],
  providers: [WalletRepository],
  exports: [WalletRepository],
})
export class WalletModule {}
