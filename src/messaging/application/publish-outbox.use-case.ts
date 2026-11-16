import { Injectable, Logger } from '@nestjs/common';

import { OutboxRepository } from '../repositories/outbox.repository.js';
import { SqsService } from '../infrastructure/sqs.service.js';

export interface PublishOutboxResult {
  claimed: number;
  published: number;
  failed: number;
  lostLease: number;
}

@Injectable()
export class PublishOutboxUseCase {
  private readonly logger = new Logger(
    PublishOutboxUseCase.name,
  );

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly sqsService: SqsService,
  ) {}

  async execute(limit = 20): Promise<PublishOutboxResult> {
    const queueUrl = process.env.SQS_EVENTS_QUEUE_URL;

    if (!queueUrl) {
      throw new Error('SQS_EVENTS_QUEUE_URL is not configured');
    }

    const claimed = await this.outboxRepository.claimPending(limit);

    const result: PublishOutboxResult = {
      claimed: claimed.length,
      published: 0,
      failed: 0,
      lostLease: 0,
    };

    for (const item of claimed) {
      try {
        await this.sqsService.sendFifo({
          queueUrl,
          body: { ...item.message.payload },
          groupId: item.message.aggregateId,
          deduplicationId: item.message.id,
        });

        const confirmed =
          await this.outboxRepository.confirmPublished(item);

        if (confirmed) {
          result.published++;
        } else {
          result.lostLease++;

          this.logger.warn(
            `Lease no longer owned after SQS publish: ${item.message.id}`,
          );
        }
      } catch (error) {
        result.failed++;

        this.logger.error(
          `Failed to publish outbox message ${item.message.id}`,
          error instanceof Error ? error.stack : String(error),
        );

        try {
          const scheduled =
            await this.outboxRepository.schedulePublishRetry(item);

          if (!scheduled) {
            result.lostLease++;
          }
        } catch (retryError) {
          this.logger.error(
            `Failed to schedule outbox retry ${item.message.id}`,
            retryError instanceof Error
              ? retryError.stack
              : String(retryError),
          );
        }
      }
    }

    return result;
  }
}
