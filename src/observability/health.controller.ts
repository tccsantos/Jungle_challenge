import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';

import { EntityManager } from '@mikro-orm/postgresql';

import { SqsService } from '../messaging/infrastructure/sqs.service.js';

interface OutboxStats {
  pending: number;
  waiting_retry: number;
  active_leases: number;
  failed_attempts: number;
}

/**
 * Health checks públicos.
 *
 * Liveness não consulta serviços externos.
 * Readiness verifica PostgreSQL e SQS.
 */
@Controller('health')
export class PublicHealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly sqs: SqsService,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    const commandQueueUrl =
      process.env.SQS_COMMANDS_QUEUE_URL;

    const eventsQueueUrl =
      process.env.SQS_EVENTS_QUEUE_URL;

    if (!commandQueueUrl || !eventsQueueUrl) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        reason: 'queue_configuration_unavailable',
      });
    }

    try {
      await this.em.fork().execute('SELECT 1');

      await Promise.all([
        this.sqs.getQueueStats(commandQueueUrl),
        this.sqs.getQueueStats(eventsQueueUrl),
      ]);

      return {
        status: 'ready',
        database: 'connected',
        sqs: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        reason: 'dependency_check_failed',
      });
    }
  }
}

/**
 * Diagnóstico operacional detalhado.
 */
@Controller('internal/health')
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly sqs: SqsService,
  ) {}

  @Get()
  async check() {
    try {
      const em = this.em.fork();

      await em.execute('SELECT 1');

      const rows = await em.execute<OutboxStats[]>(
        `
          SELECT
            COUNT(*) FILTER (
              WHERE published_at IS NULL
            )::int AS pending,

            COUNT(*) FILTER (
              WHERE published_at IS NULL
                AND next_attempt_at > NOW()
            )::int AS waiting_retry,

            COUNT(*) FILTER (
              WHERE published_at IS NULL
                AND lease_until > NOW()
            )::int AS active_leases,

            COUNT(*) FILTER (
              WHERE published_at IS NULL
                AND attempts > 0
            )::int AS failed_attempts

          FROM outbox_messages
        `,
        [],
        'all',
      );

      const commandQueueUrl =
        process.env.SQS_COMMANDS_QUEUE_URL;

      const eventsQueueUrl =
        process.env.SQS_EVENTS_QUEUE_URL;

      if (!commandQueueUrl || !eventsQueueUrl) {
        throw new Error('SQS queue URLs not configured');
      }

      const [commands, events] = await Promise.all([
        this.sqs.getQueueStats(commandQueueUrl),
        this.sqs.getQueueStats(eventsQueueUrl),
      ]);

      const stats = rows[0];

      return {
        status: 'ok',
        database: 'connected',
        outbox: {
          pending: stats?.pending ?? 0,
          waitingRetry: stats?.waiting_retry ?? 0,
          activeLeases: stats?.active_leases ?? 0,
          failedAttempts: stats?.failed_attempts ?? 0,
        },
        timestamp: new Date().toISOString(),
        sqs: {
          status: 'connected',
          commands,
          events,
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        reason: 'dependency_check_failed',
      });
    }
  }
}
