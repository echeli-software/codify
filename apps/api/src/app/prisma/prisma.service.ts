import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Singleton PrismaClient. Connects on bootstrap, disconnects on shutdown.
 *
 * Prisma 7 deprecated the native binary engine in favor of driver
 * adapters. For local Postgres + DO Managed Postgres we use
 * `@prisma/adapter-pg`, which delegates the actual SQL execution to
 * `pg` while Prisma owns the query-builder layer.
 *
 * The adapter takes a connection string from `DATABASE_URL`. Migrations
 * read the same env via `prisma.config.ts`.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env['DATABASE_URL']?.trim();
    if (!connectionString) {
      // Never fall back to an empty string: pg would silently try a local
      // socket with the OS user, which masks a missing config in deploys.
      throw new Error(
        'DATABASE_URL is not set — the API cannot connect to Postgres.',
      );
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
