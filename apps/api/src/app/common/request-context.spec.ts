import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuditService } from '../audit/audit.service.js';
import {
  MAX_USER_AGENT_LENGTH,
  RequestContextMiddleware,
  currentRequestContext,
  runWithRequestContext,
} from './request-context.js';

const req = (headers: Record<string, string>, ip = '127.0.0.1') =>
  ({ headers, ip }) as unknown as IncomingMessage;
const res = () => ({ setHeader: jest.fn() }) as unknown as ServerResponse;

function auditWith() {
  const rows: { data: Record<string, unknown> }[] = [];
  const prisma = {
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => (
        rows.push(args),
        {}
      ),
    },
  };
  return { svc: new AuditService(prisma as never), rows };
}

describe('RequestContextMiddleware', () => {
  it('exposes ip, user agent and request id to everything downstream, across awaits', async () => {
    const mw = new RequestContextMiddleware();
    const seen = await new Promise((resolve) => {
      mw.use(
        req(
          {
            'user-agent': 'Mozilla/5.0 test',
            'x-request-id': 'req-12345678',
            'cf-connecting-ip': '198.51.100.7',
          },
          '173.245.48.10',
        ),
        res(),
        () => {
          void (async () => {
            await new Promise((r) => setTimeout(r, 1));
            resolve(currentRequestContext());
          })();
        },
      );
    });
    expect(seen).toEqual({
      requestId: 'req-12345678',
      ip: '198.51.100.7',
      userAgent: 'Mozilla/5.0 test',
    });
    expect(currentRequestContext()).toBeUndefined();
  });

  it('truncates very long user agents', () => {
    const mw = new RequestContextMiddleware();
    let ua: string | null | undefined;
    mw.use(req({ 'user-agent': 'x'.repeat(2000) }), res(), () => {
      ua = currentRequestContext()?.userAgent;
    });
    expect(ua).toHaveLength(MAX_USER_AGENT_LENGTH);
  });
});

describe('AuditService + request context', () => {
  it('stamps ip + user agent from the context, overriding what callers pass', async () => {
    const { svc, rows } = auditWith();
    await runWithRequestContext(
      { requestId: 'r', ip: '198.51.100.7', userAgent: 'UA/1' },
      () =>
        svc.record(null, {
          action: 'x',
          ip: '173.245.48.10',
          userAgent: 'old',
        }),
    );
    expect(rows[0]?.data).toMatchObject({
      ip: '198.51.100.7',
      userAgent: 'UA/1',
    });
  });

  it('uses explicit values outside a request (jobs)', async () => {
    const { svc, rows } = auditWith();
    await svc.record(null, { action: 'job', ip: '10.0.0.1' });
    await svc.record(null, { action: 'job2' });
    expect(rows[0]?.data).toMatchObject({ ip: '10.0.0.1', userAgent: null });
    expect(rows[1]?.data).toMatchObject({ ip: null, userAgent: null });
  });

  it('stores before / after inside the diff', async () => {
    const { svc, rows } = auditWith();
    await svc.record(null, {
      action: 'user.role_changed',
      before: { role: 'STUDENT' },
      after: { role: 'TEACHER' },
      diff: { reason: 'promo' },
    });
    await svc.record(null, { action: 'plain' });
    expect(rows[0]?.data['diff']).toEqual({
      reason: 'promo',
      before: { role: 'STUDENT' },
      after: { role: 'TEACHER' },
    });
    expect(rows[1]?.data['diff']).toBeUndefined();
  });
});
