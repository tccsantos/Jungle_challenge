import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { OutboxMessageEntity } from './entities/outbox-message.entity.js';
import { OutboxRepository } from './repositories/outbox.repository.js';

@Module({
  imports: [
    MikroOrmModule.forFeature([OutboxMessageEntity]),
  ],
  providers: [OutboxRepository],
  exports: [OutboxRepository],
})
export class MessagingModule {}
