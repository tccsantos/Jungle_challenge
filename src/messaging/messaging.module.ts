import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { PublishOutboxUseCase } from './application/publish-outbox.use-case.js';

import { OutboxMessageEntity } from './entities/outbox-message.entity.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { OutboxPublisherWorker } from './workers/outbox-publisher.worker.js';

import { InboxRepository } from './repositories/inbox.repository.js';
import { InboxMessageEntity } from './entities/inbox-message.entity.js';

import { SqsService } from './infrastructure/sqs.service.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      OutboxMessageEntity,
      InboxMessageEntity,
    ]),
  ],
  providers: [
    InboxRepository,
    OutboxRepository,
    SqsService,
    PublishOutboxUseCase,
    OutboxPublisherWorker,
  ],
  exports: [
    InboxRepository,
    OutboxRepository,
    SqsService,
    PublishOutboxUseCase,
  ],
})
export class MessagingModule {}
