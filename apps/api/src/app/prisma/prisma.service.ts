import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env['DATABASE_URL'] ?? '',
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
