import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moves the datasource URL out of schema.prisma and into this
 * config file (or into the `PrismaClient` constructor). We keep migrations
 * driven by `DATABASE_URL` so dev / staging / prod all flow through
 * identical commands.
 *
 * See https://pris.ly/d/config-datasource
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
