import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import {
  SqsService,
} from '../../messaging/infrastructure/sqs.service.js';

import {
  ProcessWagerCommandUseCase,
} from '../application/process-wager-command.use-case.js';

@Injectable()
export class WagerCommandConsumerWorker {
  private readonly logger = new Logger(
    WagerCommandConsumerWorker.name,
  );

  constructor(
    private readonly sqsService: SqsService,
    private readonly processCommand:
      ProcessWagerCommandUseCase,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS, {
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    const queueUrl = process.env.SQS_COMMANDS_QUEUE_URL;

    if (!queueUrl) {
      this.logger.error(
        'SQS_COMMANDS_QUEUE_URL is not configured',
      );
      return;
    }

    try {
      const message = await this.sqsService.receiveOne(
        queueUrl,
      );

      if (!message) {
        return;
      }

      try {
        const result = await this.processCommand.execute(
          message.body,
        );

        await this.sqsService.deleteMessage(
          queueUrl,
          message.receiptHandle,
        );

        this.logger.log(
          `SQS message ${message.messageId}: ${result}`,
        );
      } catch (error) {
        // Não excluímos mensagens cujo processamento falhou.
        // Após o visibility timeout, o SQS tentará novamente.
        // Depois do limite configurado, irá para a DLQ.
        this.logger.error(
          `Failed to process SQS message ${message.messageId}`,
          error instanceof Error
            ? error.stack
            : String(error),
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to poll SQS commands queue',
        error instanceof Error
          ? error.stack
          : String(error),
      );
    }
  }
}
