import { Prisma } from '@prisma/client';
import {
  AccountPurgeService,
  PURGED_DISPLAY_NAME,
  purgedEmail,
} from './account-purge.service.js';

const DAY = 86_400_000;
const now = new Date('2026-11-07T03:17:00Z');

type Row = Record<string, unknown>;

/** In-memory tables with just the Prisma calls the purge makes. */
function fakeDb() {
  const t: Record<string, Row[]> = {
    user: [],
    deviceToken: [],
    notification: [],
    notificationPreference: [],
    friendNudge: [],
    friendRequest: [],
    friendship: [],
    analyticsEvent: [],
    certificate: [],
    submission: [],
    aiSubmission: [],
    xpEvent: [],
    coinTransaction: [],
    payment: [],
    auditLog: [],
  };
  const match = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, c]) => {
      if (k === 'OR') return (c as Row[]).some((w) => match(row, w));
      const v = row[k];
      if (c && typeof c === 'object' && !(c instanceof Date)) {
        const cond = c as { lt?: Date; not?: unknown; notIn?: unknown[] };
        if (cond.lt) return v instanceof Date && v < cond.lt;
        if ('not' in cond) return v !== cond.not;
        if (cond.notIn) return !cond.notIn.includes(v);
      }
      if (c === null) return v == null;
      return v === c;
    });
  const table = (name: string) => ({
    findMany: async ({ where, take }: { where: Row; take?: number }) =>
      t[name].filter((r) => match(r, where)).slice(0, take ?? Infinity),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = t[name].filter((r) => match(r, where));
      for (const r of rows) Object.assign(r, data);
      return { count: rows.length };
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const keep = t[name].filter((r) => !match(r, where));
      const count = t[name].length - keep.length;
      t[name] = keep;
      return { count };
    },
    create: async ({ data }: { data: Row }) => {
      t[name].push(data);
      return data;
    },
  });
  const prisma: Record<string, unknown> = {
    $transaction: async (fn: (tx: unknown) => unknown) => {
      const snapshot = structuredClone(t);
      try {
        return await fn(prisma);
      } catch (err) {
        Object.assign(t, snapshot);
        throw err;
      }
    },
  };
  for (const name of Object.keys(t)) prisma[name] = table(name);
  return { t, prisma };
}

function seed() {
  const db = fakeDb();
  const old = new Date(now.getTime() - 31 * DAY);
  const recent = new Date(now.getTime() - 5 * DAY);
  db.t['user'].push(
    {
      id: 'gone',
      email: 'ana@example.com',
      clerkId: 'user_ana',
      displayName: 'Ana',
      avatarConfig: { hair: 1 },
      referralCode: 'ANA1',
      quietHoursStart: 1320,
      deletedAt: old,
      deletionRequestedAt: old,
      purgedAt: null,
    },
    { id: 'grace', email: 'bo@example.com', deletedAt: recent, purgedAt: null },
    { id: 'live', email: 'cy@example.com', deletedAt: null, purgedAt: null },
  );
  for (const id of ['gone', 'grace', 'live']) {
    db.t['deviceToken'].push({ userId: id });
    db.t['notification'].push({ userId: id });
    db.t['notificationPreference'].push({ userId: id });
    db.t['analyticsEvent'].push({ userId: id });
    db.t['certificate'].push({ userId: id, recipientName: id });
    db.t['submission'].push({ userId: id, code: 'print(1)', output: 'x' });
    db.t['aiSubmission'].push({
      userId: id,
      response: 'answer',
      breakdownJson: [{}],
    });
    db.t['xpEvent'].push({ userId: id, amount: 10 });
    db.t['coinTransaction'].push({ userId: id, delta: 5 });
    db.t['payment'].push({ userId: id, amountCents: 1990 });
  }
  db.t['friendship'].push(
    { userAId: 'gone', userBId: 'live' },
    { userAId: 'grace', userBId: 'live' },
  );
  db.t['friendRequest'].push({ senderId: 'live', receiverId: 'gone' });
  db.t['friendNudge'].push({ senderId: 'gone', receiverId: 'live' });
  return db;
}

describe('AccountPurgeService', () => {
  it('anonymises accounts deleted > 30 days ago and keeps accounting rows', async () => {
    const db = seed();
    const svc = new AccountPurgeService(db.prisma as never);
    expect(await svc.purgeDue(now)).toEqual({ purged: 1, failed: 0 });

    const gone = db.t['user'].find((u) => u['id'] === 'gone')!;
    expect(gone).toMatchObject({
      email: purgedEmail('gone'),
      clerkId: 'purged:gone',
      displayName: PURGED_DISPLAY_NAME,
      avatarConfig: Prisma.DbNull,
      referralCode: null,
      quietHoursStart: null,
      purgedAt: now,
    });
    const of = (table: string, id: string) =>
      db.t[table].filter((r) => r['userId'] === id);
    for (const table of [
      'deviceToken',
      'notification',
      'notificationPreference',
      'analyticsEvent',
      'certificate',
    ]) {
      expect(of(table, 'gone')).toHaveLength(0);
      expect(of(table, 'grace')).toHaveLength(1);
      expect(of(table, 'live')).toHaveLength(1);
    }
    expect(db.t['friendship']).toEqual([{ userAId: 'grace', userBId: 'live' }]);
    expect(db.t['friendRequest']).toHaveLength(0);
    expect(db.t['friendNudge']).toHaveLength(0);
    expect(of('submission', 'gone')[0]).toMatchObject({
      code: '',
      output: null,
    });
    expect(of('submission', 'live')[0]).toMatchObject({ code: 'print(1)' });
    expect(of('aiSubmission', 'gone')[0]).toMatchObject({
      response: '',
      breakdownJson: [],
    });
    // Ledger + payments are retained (anonymised via the user row).
    expect(of('xpEvent', 'gone')).toHaveLength(1);
    expect(of('coinTransaction', 'gone')).toHaveLength(1);
    expect(of('payment', 'gone')).toHaveLength(1);
    expect(db.t['auditLog']).toEqual([
      expect.objectContaining({ action: 'user.purged', entityId: 'gone' }),
    ]);
    // Grace-period and live accounts untouched.
    expect(db.t['user'].find((u) => u['id'] === 'grace')).toMatchObject({
      email: 'bo@example.com',
      purgedAt: null,
    });
  });

  it('is idempotent', async () => {
    const db = seed();
    const svc = new AccountPurgeService(db.prisma as never);
    await svc.purgeDue(now);
    const snapshot = JSON.stringify(db.t);
    expect(await svc.purgeDue(now)).toEqual({ purged: 0, failed: 0 });
    expect(await svc.purgeUser('gone', now)).toBe(false);
    expect(await svc.purgeUser('live', now)).toBe(false);
    expect(JSON.stringify(db.t)).toBe(snapshot);
  });

  it('a failing user rolls back and does not block the others', async () => {
    const db = seed();
    const old = new Date(now.getTime() - 40 * DAY);
    db.t['user'].push({
      id: 'gone2',
      email: 'd@x.y',
      deletedAt: old,
      purgedAt: null,
    });
    const certs = db.prisma['certificate'] as {
      deleteMany: (a: unknown) => unknown;
    };
    const real = certs.deleteMany;
    certs.deleteMany = async (a: unknown) => {
      if ((a as { where: { userId: string } }).where.userId === 'gone2')
        throw new Error('boom');
      return real(a);
    };
    const svc = new AccountPurgeService(db.prisma as never);
    expect(await svc.purgeDue(now)).toEqual({ purged: 1, failed: 1 });
    expect(db.t['user'].find((u) => u['id'] === 'gone2')).toMatchObject({
      email: 'd@x.y',
      purgedAt: null,
    });
  });
});
