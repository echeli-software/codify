import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

const logger = new Logger('ServerAnalytics');

/**
 * Server-side product-analytics events (docs/10 §14 "Server-side events …
 * are written directly by the service that owns the flow"). The analytics
 * module only exposes client ingestion, so the notification flows write
 * their rows here. Best-effort: analytics never fails delivery.
 */
export async function recordServerEvent(
  prisma: Pick<PrismaService, 'analyticsEvent'>,
  userId: string | null,
  name: string,
  props: Record<string, string | number | boolean | null>,
  at: Date = new Date(),
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        userId,
        name,
        props: props as Prisma.InputJsonValue,
        platform: 'server',
        occurredAt: at,
      },
    });
  } catch (err) {
    logger.warn(`analytics ${name} not recorded: ${(err as Error).message}`);
  }
}
