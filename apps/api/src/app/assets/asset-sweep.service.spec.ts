import {
  AssetSweepService,
  assetSweepPolicyFromEnv,
  collectIds,
  type AssetSweepPolicy,
} from './asset-sweep.service.js';

const NOW = new Date('2026-11-08T04:41:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const id = (n: number) =>
  `0192f3a4-0000-7000-8000-${String(n).padStart(12, '0')}`;

interface AssetRow {
  id: string;
  key: string;
  confirmed: boolean;
  createdAt: Date;
}

function setup(
  assets: AssetRow[],
  refs: {
    lessons?: unknown[];
    translations?: string[];
    cover?: string;
    badge?: string;
    sprite?: string;
    scenario?: unknown;
    config?: unknown;
  } = {},
  policy: Partial<AssetSweepPolicy> = {},
) {
  const rows = [...assets];
  const page = <T>(items: T[]) =>
    jest.fn(async ({ cursor }: { cursor?: { id: string } }) =>
      cursor ? [] : items,
    );
  const prisma = {
    asset: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { confirmed: boolean; createdAt: { lt: Date } };
        }) =>
          rows.filter(
            (r) =>
              r.confirmed === where.confirmed &&
              r.createdAt < where.createdAt.lt,
          ),
      ),
      deleteMany: jest.fn(
        async ({ where }: { where: { id: string; confirmed: boolean } }) => {
          const i = rows.findIndex(
            (r) => r.id === where.id && r.confirmed === where.confirmed,
          );
          if (i < 0) return { count: 0 };
          rows.splice(i, 1);
          return { count: 1 };
        },
      ),
    },
    course: {
      findMany: jest.fn(async () =>
        refs.cover ? [{ coverAssetId: refs.cover }] : [],
      ),
    },
    badge: {
      findMany: jest.fn(async () =>
        refs.badge ? [{ iconAssetId: refs.badge }] : [],
      ),
    },
    item: {
      findMany: jest.fn(async () => [
        { spriteAssetId: refs.sprite ?? 'emoji:🎩', thumbnailAssetId: null },
      ]),
    },
    lesson: {
      findMany: page(
        (refs.lessons ?? []).map((c, i) => ({ id: `l${i}`, contentJson: c })),
      ),
    },
    contentTranslation: {
      findMany: page(
        (refs.translations ?? []).map((v, i) => ({ id: `t${i}`, value: v })),
      ),
    },
    scenario: {
      findMany: page(
        refs.scenario ? [{ id: 's1', graphJson: refs.scenario }] : [],
      ),
    },
    aiPrompt: { findMany: page([]) },
    gamificationConfig: {
      findMany: jest.fn(async () =>
        refs.config ? [{ value: refs.config }] : [],
      ),
    },
  };
  const storage = { delete: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => undefined) };
  const svc = new AssetSweepService(
    prisma as never,
    storage as never,
    {
      unconfirmedHours: 24,
      unreferencedDays: 30,
      dryRun: false,
      maxDeletes: 500,
      ...policy,
    },
    audit as never,
  );
  return { svc, rows, storage, audit };
}

const asset = (n: number, confirmed: boolean, ageMs: number): AssetRow => ({
  id: id(n),
  key: `image/2026/10/${id(n)}.png`,
  confirmed,
  createdAt: new Date(NOW.getTime() - ageMs),
});

describe('AssetSweepService', () => {
  it('deletes abandoned uploads older than 24 h (storage first, then the row)', async () => {
    const { svc, rows, storage, audit } = setup([
      asset(1, false, 25 * HOUR),
      asset(2, false, 2 * HOUR),
    ]);
    const r = await svc.sweep(NOW);
    expect(r.unconfirmed).toEqual({ candidates: 1, deleted: 1 });
    expect(storage.delete).toHaveBeenCalledWith(`image/2026/10/${id(1)}.png`);
    expect(rows.map((a) => a.id)).toEqual([id(2)]);
    expect(audit.record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'asset.swept' }),
    );
  });

  it('keeps every referenced asset and deletes only old unreferenced ones', async () => {
    const assets = [
      asset(10, true, 40 * DAY), // lesson image block (assetId)
      asset(11, true, 40 * DAY), // translated lesson body (URL embeds the id)
      asset(12, true, 40 * DAY), // course cover
      asset(13, true, 40 * DAY), // badge icon
      asset(14, true, 40 * DAY), // item sprite
      asset(15, true, 40 * DAY), // scenario graph
      asset(16, true, 40 * DAY), // site settings
      asset(17, true, 40 * DAY), // orphan → deleted
      asset(18, true, 5 * DAY), //  orphan but recent → kept
    ];
    const { svc, rows } = setup(assets, {
      lessons: [
        {
          type: 'doc',
          content: [{ type: 'image', attrs: { assetId: id(10) } }],
        },
      ],
      translations: [
        JSON.stringify({
          src: `https://cdn.codify.app/image/2026/10/${id(11).toUpperCase()}.png`,
        }),
      ],
      cover: id(12),
      badge: id(13),
      sprite: id(14),
      scenario: { nodes: [{ image: id(15) }] },
      config: { logoAssetId: id(16) },
    });
    const r = await svc.sweep(NOW);
    expect(r.unreferenced).toEqual({ candidates: 1, deleted: 1 });
    expect(r.sample).toEqual([id(17)]);
    expect(rows.map((a) => a.id)).not.toContain(id(17));
    expect(rows).toHaveLength(8);
  });

  it('dry run logs candidates and deletes nothing', async () => {
    const { svc, rows, storage, audit } = setup(
      [asset(1, false, 30 * HOUR), asset(2, true, 60 * DAY)],
      {},
      { dryRun: true },
    );
    const r = await svc.sweep(NOW);
    expect(r).toMatchObject({
      dryRun: true,
      unconfirmed: { deleted: 1 },
      unreferenced: { deleted: 1 },
    });
    expect(rows).toHaveLength(2);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a storage failure keeps the row; maxDeletes bounds a run', async () => {
    const failing = setup([asset(1, false, 30 * HOUR)]);
    failing.storage.delete.mockRejectedValueOnce(new Error('R2 down'));
    const r = await failing.svc.sweep(NOW);
    expect(r).toMatchObject({ failed: 1, unconfirmed: { deleted: 0 } });
    expect(failing.rows).toHaveLength(1);

    const capped = setup(
      [1, 2, 3].map((n) => asset(n, false, 30 * HOUR)),
      {},
      { maxDeletes: 2 },
    );
    expect((await capped.svc.sweep(NOW)).unconfirmed.deleted).toBe(2);
    expect(capped.rows).toHaveLength(1);
  });
});

describe('asset sweep policy + id extraction', () => {
  it('defaults: 24 h / 30 d, dry run outside production only', () => {
    expect(assetSweepPolicyFromEnv({})).toEqual({
      unconfirmedHours: 24,
      unreferencedDays: 30,
      dryRun: true,
      maxDeletes: 500,
    });
    expect(assetSweepPolicyFromEnv({ NODE_ENV: 'production' }).dryRun).toBe(
      false,
    );
    expect(
      assetSweepPolicyFromEnv({ ASSET_SWEEP_DRY_RUN: 'false' }).dryRun,
    ).toBe(false);
    expect(() =>
      assetSweepPolicyFromEnv({ ASSET_SWEEP_UNREFERENCED_DAYS: '0' }),
    ).toThrow(/ASSET_SWEEP_UNREFERENCED_DAYS/);
  });

  it('collects UUIDs case-insensitively from any text', () => {
    const s = new Set<string>();
    collectIds(`x ${id(1).toUpperCase()} /assets/dev/${id(2)} y`, s);
    expect([...s]).toEqual([id(1), id(2)]);
  });
});
