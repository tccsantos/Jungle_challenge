import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Cron,
  CronExpression,
} from '@nestjs/schedule';

import { RetryPendingReferencesUseCase } from '../application/retry-pending-references.use-case.js';

@Injectable()
export class PendingReferenceWorker {
  private readonly logger = new Logger(
    PendingReferenceWorker.name,
  );

  private running = false;

  constructor(
    private readonly retryPendingReferences:
      RetryPendingReferencesUseCase,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS, {
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const result = await this.retryPendingReferences.execute();

      if (
        result.processed > 0 ||
        result.rejected > 0 ||
        result.rescheduled > 0
      ) {
        this.logger.log(
          `Pending references: ${JSON.stringify(result)}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to process pending references',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
