import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  database: 'up' | 'down';
}

/**
 * Liveness + readiness probe consumed by load balancers / Coolify
 * health checks. Public — no auth required. Returns `degraded` (still
 * 200) when Postgres is unreachable so probes can decide based on the
 * `database` field.
 */
@Controller('health')
@Public()
export class HealthController {
  private readonly startedAt = Date.now();
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      database,
    };
  }
}
