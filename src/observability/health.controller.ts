import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

interface OutboxStats {
  pending: number;
  waiting_retry: number;
  active_leases: number;
  failed_attempts: number;
}

@Controller('internal/health')
export class HealthController {
  constructor(private readonly em: EntityManager) {}

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
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        database: 'unavailable',
      });
    }
  }
}
