
import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { randomUUID } from 'node:crypto';

const runId = process.env.TEST_RUN_ID!;
const messageId = process.env.TEST_MESSAGE_ID!;

const client = new SQSClient({
  endpoint: process.env.AWS_SQS_ENDPOINT,
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

try {
  const result = await client.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_COMMANDS_QUEUE_URL!,
      MessageGroupId: `crash-${runId}`,
      MessageDeduplicationId: randomUUID(),
      MessageBody: JSON.stringify({
        messageId,
        commandType: 'ProcessWagerTransaction',
        schemaVersion: 1,
        data: {
          providerId: 'crash-test',
          externalTransactionId: `bet-${runId}`,
          idempotencyKey: `key-${runId}`,
          walletId: process.env.TEST_WALLET_ID,
          playerId: process.env.TEST_PLAYER_ID,
          roundId: `round-${runId}`,
          gameId: 'crash-game',
          kind: 'BET',
          money: {
            amount: '40.00',
            currency: 'BRL',
          },
        },
      }),
    }),
  );

  console.log('Published:', result.MessageId);
} finally {
  client.destroy();
}
