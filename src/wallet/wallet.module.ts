import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { WalletEntity } from './entities/wallet.entity.js';
import { WalletRepository } from './repositories/wallet.repository.js';
import { CreateWalletUseCase } from './application/create-wallet.use-case.js';
import { WalletController } from './wallet.controller.js';

@Module({
  imports: [MikroOrmModule.forFeature([WalletEntity])],
  controllers: [WalletController],
  providers: [
    WalletRepository,
    CreateWalletUseCase,
  ],
  exports: [
    WalletRepository,
    CreateWalletUseCase,
  ],
})
export class WalletModule {}
