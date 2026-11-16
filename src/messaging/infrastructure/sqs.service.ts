import {
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';

import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

export interface SendFifoMessageInput {
  queueUrl: string;
  body: Record<string, unknown>;
  groupId: string;
  deduplicationId: string;
}

export interface ReceivedSqsMessage {
  messageId: string;
  body: string;
  receiptHandle: string;
}

@Injectable()
export class SqsService implements OnModuleDestroy {
  private readonly client: SQSClient;

  constructor() {
    const endpoint = process.env.AWS_SQS_ENDPOINT;

    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(endpoint
        ? {
            endpoint,
            credentials: {
              accessKeyId:
                process.env.AWS_ACCESS_KEY_ID ?? 'test',
              secretAccessKey:
                process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
            },
          }
        : {}),
    });
  }

  async sendFifo(
    input: SendFifoMessageInput,
  ): Promise<string> {
    if (
      !input.queueUrl ||
      !input.groupId ||
      !input.deduplicationId
    ) {
      throw new Error(
        'Queue URL, group ID and deduplication ID are required',
      );
    }

    const response = await this.client.send(
      new SendMessageCommand({
        QueueUrl: input.queueUrl,
        MessageBody: JSON.stringify(input.body),
        MessageGroupId: input.groupId,
        MessageDeduplicationId:
          input.deduplicationId,
      }),
    );

    if (!response.MessageId) {
      throw new Error(
        'SQS did not return a MessageId',
      );
    }

    return response.MessageId;
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }


  async receiveOne(
    queueUrl: string,
  ): Promise<ReceivedSqsMessage | undefined> {
    if (!queueUrl) {
      throw new Error('SQS queue URL is required');
    }

    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 60,
      }),
    );

    const message = response.Messages?.[0];

    if (!message) {
      return undefined;
    }

    if (
      !message.MessageId ||
      message.Body === undefined ||
      !message.ReceiptHandle
    ) {
      throw new Error('Incomplete SQS message');
    }

    return {
      messageId: message.MessageId,
      body: message.Body,
      receiptHandle: message.ReceiptHandle,
    };
  }

  async deleteMessage(
    queueUrl: string,
    receiptHandle: string,
  ): Promise<void> {
    if (!queueUrl || !receiptHandle) {
      throw new Error('Invalid SQS deletion parameters');
    }

    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

}
