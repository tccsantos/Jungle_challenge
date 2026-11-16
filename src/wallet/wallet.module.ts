import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { WalletEntity } from './entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity.js';

import { WalletRepository } from './repositories/wallet.repository.js';
import { WalletLedgerRepository } from './repositories/wallet-ledger.repository.js';

import { CreateWalletUseCase } from './application/create-wallet.use-case.js';
import { WalletController } from './wallet.controller.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      WalletEntity,
      WalletLedgerEntryEntity,
    ]),
  ],
  controllers: [WalletController],
  providers: [
    WalletRepository,
    WalletLedgerRepository,
    CreateWalletUseCase,
  ],
  exports: [
    WalletRepository,
    WalletLedgerRepository,
    CreateWalletUseCase,
  ],
})
export class WalletModule {}
