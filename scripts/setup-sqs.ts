
import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const region = process.env.AWS_REGION ?? 'us-east-1';

const client = new SQSClient({
  endpoint: process.env.AWS_SQS_ENDPOINT,
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

const queueName = 'wager-transactions.fifo';
const dlqName = 'wager-transactions-dlq.fifo';

async function main(): Promise<void> {
  const oldQueueUrl = process.env.SQS_COMMANDS_QUEUE_URL;

  if (!oldQueueUrl) {
    throw new Error('SQS_COMMANDS_QUEUE_URL is required');
  }

  const queueBaseUrl = oldQueueUrl.slice(
    0,
    oldQueueUrl.lastIndexOf('/') + 1,
  );

  const dlqUrl = `${queueBaseUrl}${dlqName}`;
  const commandsUrl = `${queueBaseUrl}${queueName}`;

  // 1. Criar a DLQ FIFO.
  await client.send(
    new CreateQueueCommand({
      QueueName: dlqName,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'false',
        VisibilityTimeout: '30',
      },
    }),
  );

  // 2. Obter o ARN da DLQ.
  const dlqAttributes = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl,
      AttributeNames: ['QueueArn'],
    }),
  );

  const dlqArn = dlqAttributes.Attributes?.QueueArn;

  if (!dlqArn) {
    throw new Error('Unable to retrieve DLQ ARN');
  }

  // 3. Criar a fila principal com política de redrive.
  await client.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'false',
        VisibilityTimeout: '60',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: 5,
        }),
      },
    }),
  );

  // 4. Conferir a configuração final.
  for (const [name, url] of [
    ['COMMANDS', commandsUrl],
    ['DLQ', dlqUrl],
  ]) {
    const result = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ['All'],
      }),
    );

    console.log(`\n=== ${name} ===`);
    console.log('URL:', url);
    console.log('ARN:', result.Attributes?.QueueArn);
    console.log('FIFO:', result.Attributes?.FifoQueue);
    console.log(
      'RedrivePolicy:',
      result.Attributes?.RedrivePolicy ?? 'none',
    );
  }
}

try {
  await main();
} finally {
  client.destroy();
}
