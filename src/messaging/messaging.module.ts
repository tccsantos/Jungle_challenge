import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { OutboxMessageEntity } from './entities/outbox-message.entity.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { PublishOutboxUseCase } from './application/publish-outbox.use-case.js';
import { OutboxPublisherWorker } from './workers/outbox-publisher.worker.js';

import { SqsService } from './infrastructure/sqs.service.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([OutboxMessageEntity]),
  ],
  providers: [
    OutboxRepository,
    SqsService,
    PublishOutboxUseCase,
    OutboxPublisherWorker,
  ],
  exports: [
    OutboxRepository,
    SqsService,
    PublishOutboxUseCase,
  ],
})
export class MessagingModule {}
