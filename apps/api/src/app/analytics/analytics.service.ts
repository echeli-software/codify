import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MAX_PROPS_BYTES,
  type AnalyticsBatchDto,
  type AnalyticsSummaryRow,
} from './analytics.dto.js';

const DAY_MS = 86_400_000;
/** Events older than this (offline backlog) are clamped to receipt time. */
const MAX_EVENT_AGE_MS = 7 * DAY_MS;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SUMMARY_DAYS = 92;

/**
 * First-party product analytics (docs/10 §14, docs/14 §12 — no third-party
 * trackers). Clients batch events; signed-in events are attributed to the
 * user, otherwise to the install's anonymousId.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    userId: string | null,
    batch: AnalyticsBatchDto,
    now = new Date(),
  ): Promise<{ accepted: number }> {
    if (!userId && !batch.anonymousId) {
      throw new BadRequestException('anonymousId is required when signed out');
    }
    const rows: Prisma.AnalyticsEventCreateManyInput[] = batch.events.map(
      (e) => {
        const props = e.props ?? null;
        if (
          props &&
          Buffer.byteLength(JSON.stringify(props)) > MAX_PROPS_BYTES
        ) {
          throw new BadRequestException(
            `props for "${e.name}" exceed ${MAX_PROPS_BYTES} bytes`,
          );
        }
        return {
          userId,
          anonymousId: batch.anonymousId ?? null,
          name: e.name,
          props: (props ?? undefined) as Prisma.InputJsonValue | undefined,
          platform: batch.platform ?? null,
          appVersion: batch.appVersion ?? null,
          occurredAt: clampOccurredAt(e.occurredAt, now),
        };
      },
    );
    const res = await this.prisma.analyticsEvent.createMany({ data: rows });
    return { accepted: res.count };
  }

  async summary(
    fromIso?: string,
    toIso?: string,
  ): Promise<AnalyticsSummaryRow[]> {
    const to = toIso ? new Date(toIso) : new Date();
    const from = fromIso
      ? new Date(fromIso)
      : new Date(to.getTime() - 30 * DAY_MS);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to
    ) {
      throw new BadRequestException('from must be a date before to');
    }
    if (to.getTime() - from.getTime() > MAX_SUMMARY_DAYS * DAY_MS) {
      throw new BadRequestException(
        `Range is limited to ${MAX_SUMMARY_DAYS} days`,
      );
    }
    const rows = await this.prisma.$queryRaw<
      { name: string; day: Date; count: bigint }[]
    >`
      SELECT name, date_trunc('day', "occurredAt" AT TIME ZONE 'UTC') AS day, count(*) AS count
      FROM "AnalyticsEvent"
      WHERE "occurredAt" >= ${from} AND "occurredAt" < ${to}
      GROUP BY name, day
      ORDER BY day ASC, name ASC`;
    return rows.map((r) => ({
      name: r.name,
      day: new Date(r.day).toISOString().slice(0, 10),
      count: Number(r.count),
    }));
  }
}

/** Trust the device clock within bounds; otherwise use receipt time. */
export function clampOccurredAt(iso: string, now: Date): Date {
  const t = Date.parse(iso);
  if (
    !Number.isFinite(t) ||
    t > now.getTime() + MAX_CLOCK_SKEW_MS ||
    t < now.getTime() - MAX_EVENT_AGE_MS
  ) {
    return now;
  }
  return new Date(t);
}
