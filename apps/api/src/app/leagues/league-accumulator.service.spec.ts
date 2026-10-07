import { LeagueAccumulatorService } from './league-accumulator.service';

/**
 * Cohort placement must be serialized per (tier, week): concurrent first-time
 * placements otherwise read the same open-cohort count and overfill it
 * (tools/load/league-sharding.mjs reproduced cohorts of 31–35).
 */
describe('LeagueAccumulatorService.ensureMembership', () => {
  function makeTx(
    overrides: {
      existing?: unknown;
      placedAfterLock?: unknown;
      leagues?: unknown[];
    } = {},
  ) {
    const calls: string[] = [];
    let membershipLookups = 0;
    const tx = {
      $executeRaw: jest.fn(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.push(`lock:${strings.join('?')}:${values.join(',')}`);
          return 1;
        },
      ),
      leagueMembership: {
        findFirst: jest.fn(
          async (args: { where: { league?: { weekStart?: unknown } } }) => {
            const weekStart = args.where.league?.weekStart;
            if (
              weekStart &&
              typeof weekStart === 'object' &&
              'lt' in (weekStart as object)
            ) {
              calls.push('resolveTier');
              return null; // no prior week → BRONZE
            }
            membershipLookups += 1;
            calls.push(`membership#${membershipLookups}`);
            if (membershipLookups === 1) return overrides.existing ?? null;
            return overrides.placedAfterLock ?? null;
          },
        ),
        create: jest.fn(async () => {
          calls.push('create-membership');
          return {};
        }),
      },
      league: {
        findMany: jest.fn(async () => {
          calls.push('find-cohorts');
          return overrides.leagues ?? [];
        }),
        create: jest.fn(async () => {
          calls.push('create-league');
          return { id: 'league-new' };
        }),
      },
    };
    return { tx, calls };
  }

  it('returns an existing membership without taking the lock', async () => {
    const { tx, calls } = makeTx({ existing: { leagueId: 'l1' } });
    const res = await new LeagueAccumulatorService().ensureMembership(
      tx as never,
      'u1',
    );
    expect(res).toEqual({ leagueId: 'l1' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(calls).toEqual(['membership#1']);
  });

  it('takes a per-tier/week advisory lock before reading cohort counts', async () => {
    const { tx, calls } = makeTx({
      leagues: [{ id: 'l-open', _count: { members: 12 } }],
    });
    const res = await new LeagueAccumulatorService().ensureMembership(
      tx as never,
      'u1',
    );
    expect(res).toEqual({ leagueId: 'l-open' });
    const lockIdx = calls.findIndex((c) => c.startsWith('lock:'));
    expect(lockIdx).toBeGreaterThan(-1);
    expect(calls[lockIdx]).toContain('pg_advisory_xact_lock');
    expect(calls[lockIdx]).toMatch(/league:BRONZE:\d{4}-\d{2}-\d{2}T/);
    expect(lockIdx).toBeLessThan(calls.indexOf('find-cohorts'));
    expect(calls).toContain('create-membership');
  });

  it('re-checks membership after acquiring the lock (concurrent duplicate request)', async () => {
    const { tx } = makeTx({ placedAfterLock: { leagueId: 'l-raced' } });
    const res = await new LeagueAccumulatorService().ensureMembership(
      tx as never,
      'u1',
    );
    expect(res).toEqual({ leagueId: 'l-raced' });
    expect(tx.league.findMany).not.toHaveBeenCalled();
    expect(tx.leagueMembership.create).not.toHaveBeenCalled();
  });

  it('opens a new cohort when every cohort is full', async () => {
    const { tx } = makeTx({
      leagues: [{ id: 'l-full', _count: { members: 30 } }],
    });
    const res = await new LeagueAccumulatorService().ensureMembership(
      tx as never,
      'u1',
    );
    expect(res).toEqual({ leagueId: 'league-new' });
    expect(tx.league.create).toHaveBeenCalledTimes(1);
  });
});
