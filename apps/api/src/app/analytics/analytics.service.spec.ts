import { BadRequestException } from '@nestjs/common';
import { AnalyticsService, clampOccurredAt } from './analytics.service.js';

const now = new Date('2026-10-07T12:00:00Z');

function setup() {
  const prisma = {
    analyticsEvent: {
      createMany: jest.fn(async (args: { data: unknown[] }) => ({
        count: args.data.length,
      })),
    },
    $queryRaw: jest.fn(async () => [
      {
        name: 'lesson_completed',
        day: new Date('2026-10-06T00:00:00Z'),
        count: 3n,
      },
    ]),
  };
  return { svc: new AnalyticsService(prisma as never), prisma };
}

describe('AnalyticsService', () => {
  it('stores a signed-in batch attributed to the user', async () => {
    const { svc, prisma } = setup();
    const res = await svc.ingest(
      'u1',
      {
        platform: 'web',
        events: [
          {
            name: 'lesson_completed',
            props: { lessonId: 'l1' },
            occurredAt: now.toISOString(),
          },
        ],
      },
      now,
    );
    expect(res).toEqual({ accepted: 1 });
    const data = (
      prisma.analyticsEvent.createMany.mock.calls[0][0] as {
        data: Record<string, unknown>[];
      }
    ).data;
    expect(data[0]).toMatchObject({
      userId: 'u1',
      name: 'lesson_completed',
      platform: 'web',
    });
  });

  it('requires an anonymousId when signed out', async () => {
    const { svc } = setup();
    await expect(
      svc.ingest(
        null,
        { events: [{ name: 'app_opened', occurredAt: now.toISOString() }] },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.ingest(
        null,
        {
          anonymousId: 'install-1234',
          events: [{ name: 'app_opened', occurredAt: now.toISOString() }],
        },
        now,
      ),
    ).resolves.toEqual({ accepted: 1 });
  });

  it('rejects oversized props', async () => {
    const { svc } = setup();
    await expect(
      svc.ingest(
        'u1',
        {
          events: [
            {
              name: 'x_y',
              props: { blob: 'a'.repeat(5000) },
              occurredAt: now.toISOString(),
            },
          ],
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clamps implausible device times to receipt time', () => {
    expect(clampOccurredAt('2026-10-07T11:00:00Z', now).toISOString()).toBe(
      '2026-10-07T11:00:00.000Z',
    );
    expect(clampOccurredAt('2026-10-07T13:00:00Z', now)).toBe(now);
    expect(clampOccurredAt('2026-09-01T00:00:00Z', now)).toBe(now);
    expect(clampOccurredAt('garbage', now)).toBe(now);
  });

  it('summarises counts per name per day and bounds the range', async () => {
    const { svc } = setup();
    await expect(
      svc.summary('2026-10-01T00:00:00Z', '2026-10-07T00:00:00Z'),
    ).resolves.toEqual([
      { name: 'lesson_completed', day: '2026-10-06', count: 3 },
    ]);
    await expect(
      svc.summary('2026-01-01T00:00:00Z', '2026-10-07T00:00:00Z'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.summary('2026-10-07T00:00:00Z', '2026-10-01T00:00:00Z'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
