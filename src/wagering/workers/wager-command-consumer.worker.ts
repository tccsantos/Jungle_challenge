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
      const message = await this.sqsService.receiveOne(queueUrl);

      if (!message) {
        return;
      }

      let result: string;

      try {
        result = await this.processCommand.execute(message.body);
      } catch (error) {
        this.logger.error(
          `Failed to process SQS message ${message.messageId}`,
          error instanceof Error ? error.stack : String(error),
        );

        // Sem ACK: mensagem fica elegível para reentrega.
        return;
      }

      try {
        await this.sqsService.deleteMessage(
          queueUrl,
          message.receiptHandle,
        );

        this.logger.log(
          `SQS message ${message.messageId}: ${result}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to ACK SQS message ${message.messageId}`,
          error instanceof Error ? error.stack : String(error),
        );

        // O processamento já pode estar confirmado no banco.
        // A Inbox impedirá efeitos duplicados na reentrega.
      }
    } catch (error) {
      this.logger.error(
        'Failed to poll SQS commands queue',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

}
