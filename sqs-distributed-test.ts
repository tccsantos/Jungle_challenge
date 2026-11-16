
import { randomUUID } from 'node:crypto';

import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';

const walletId = process.env.TEST_WALLET_ID;
const playerId = process.env.TEST_PLAYER_ID;
const runId = process.env.TEST_RUN_ID;

const queueUrl = process.env.SQS_COMMANDS_QUEUE_URL;

if (!walletId || !playerId || !runId || !queueUrl) {
  throw new Error('Missing SQS test configuration');
}

const client = new SQSClient({
  endpoint: process.env.AWS_SQS_ENDPOINT,
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

const transaction = {
  providerId: 'sqs-distributed-test',
  externalTransactionId: `bet-${runId}`,
  idempotencyKey: `key-${runId}`,
  walletId,
  playerId,
  roundId: `round-${runId}`,
  gameId: 'distributed-game',
  kind: 'BET',
  money: {
    amount: '40.00',
    currency: 'BRL',
  },
};

try {
  const messages = Array.from(
    { length: 12 },
    (_, index) => ({
      index,
      messageId: randomUUID(),
    }),
  );

  const results = await Promise.all(
    messages.map(async ({ index, messageId }) => {
      const groupId = `distributed-${runId}-${index % 3}`;

      const response = await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,

          MessageGroupId: groupId,

          // Cada envio deve chegar ao SQS como
          // uma mensagem distinta.
          MessageDeduplicationId: randomUUID(),

          MessageBody: JSON.stringify({
            messageId,
            commandType: 'ProcessWagerTransaction',
            schemaVersion: 1,
            data: transaction,
          }),
        }),
      );

      if (!response.MessageId) {
        throw new Error(
          `SQS did not accept message ${index}`,
        );
      }

      return {
        index,
        messageId,
        sqsMessageId: response.MessageId,
        groupId,
      };
    }),
  );

  console.log(
    JSON.stringify(
      {
        walletId,
        externalTransactionId:
          transaction.externalTransactionId,
        submitted: results.length,
        messages: results,
      },
      null,
      2,
    ),
  );
} finally {
  client.destroy();
}
