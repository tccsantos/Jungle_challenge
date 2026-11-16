import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PublishOutboxUseCase } from '../application/publish-outbox.use-case.js';

@Injectable()
export class OutboxPublisherWorker {
  private readonly logger = new Logger(
    OutboxPublisherWorker.name,
  );

  constructor(
    private readonly publishOutbox: PublishOutboxUseCase,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS, {
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    try {
      const result = await this.publishOutbox.execute();

      if (
        result.published > 0 ||
        result.failed > 0 ||
        result.lostLease > 0
      ) {
        this.logger.log(
          `Outbox publishing: ${JSON.stringify(result)}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Outbox publishing cycle failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
