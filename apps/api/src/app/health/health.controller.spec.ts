import { HealthController } from './health.controller.js';

const okPrisma = {
  $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
};
const downPrisma = {
  $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
};

describe('HealthController', () => {
  it('is ok when Postgres and Redis answer', async () => {
    const redis = { ping: jest.fn().mockResolvedValue('PONG') };
    const res = await new HealthController(
      okPrisma as never,
      redis as never,
    ).check();
    expect(res).toMatchObject({ status: 'ok', database: 'up', redis: 'up' });
  });

  it('reports degraded (never throws) when Redis is down', async () => {
    const redis = { ping: jest.fn().mockRejectedValue(new Error('timeout')) };
    const res = await new HealthController(
      okPrisma as never,
      redis as never,
    ).check();
    expect(res).toMatchObject({
      status: 'degraded',
      database: 'up',
      redis: 'down',
    });
  });

  it('reports degraded when the database is down', async () => {
    const res = await new HealthController(downPrisma as never, null).check();
    expect(res).toMatchObject({
      status: 'degraded',
      database: 'down',
      redis: 'not_configured',
    });
  });

  it('is ok without Redis configured (dev)', async () => {
    const res = await new HealthController(okPrisma as never, null).check();
    expect(res.status).toBe('ok');
  });
});
