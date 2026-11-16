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

import { ProcessWagerCommandUseCase } from './application/process-wager-command.use-case.js';
import { WagerCommandConsumerWorker } from './workers/wager-command-consumer.worker.js';

import { WagerTransactionQueryRepository } from './repositories/wager-transaction-query.repository.js';
import { WagerTransactionQueryController } from './wager-transaction-query.controller.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([WagerTransactionEntity]),
    WalletModule,
    MessagingModule,
  ],
  controllers: [
    WageringController,
    WagerTransactionQueryController,
  ],
  providers: [
    WagerTransactionRepository,
    ProcessWagerTransactionUseCase,
    RetryPendingReferencesUseCase,
    PendingReferenceWorker,
    ProcessWagerCommandUseCase,
    WagerCommandConsumerWorker,
    WagerTransactionQueryRepository,
  ],
  exports: [
    WagerTransactionRepository,
    ProcessWagerTransactionUseCase,
  ],
})
export class WageringModule {}
