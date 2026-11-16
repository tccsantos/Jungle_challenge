import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WagerTransactionRepository } from './repositories/wager-transaction.repository.js';

import { WalletModule } from '../wallet/wallet.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { ProcessWagerTransactionUseCase } from './application/process-wager-transaction.use-case.js';
import { WageringController } from './wagering.controller.js';
import { RetryPendingReferencesUseCase } from './application/retry-pending-references.use-case.js';

import { PendingReferenceWorker } from './workers/pending-reference.worker.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([WagerTransactionEntity]),
    WalletModule,
    MessagingModule,
  ],
  controllers: [WageringController],
  providers: [
    WagerTransactionRepository,
    ProcessWagerTransactionUseCase,
    RetryPendingReferencesUseCase,
    PendingReferenceWorker,
  ],
  exports: [
    WagerTransactionRepository,
    ProcessWagerTransactionUseCase,
  ],
})
export class WageringModule {}
