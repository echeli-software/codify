import { NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { parseEnv } from '../config/env.schema.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';
import { reportException } from './sentry.js';

jest.mock('./sentry.js', () => ({ reportException: jest.fn() }));

function host(req: Record<string, unknown>) {
  const res = {
    headersSent: false,
    headers: {} as Record<string, string>,
    statusCode: 0,
    contentType: '',
    payload: '',
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type(t: string) {
      this.contentType = t;
      return this;
    },
    send(body: string) {
      this.payload = body;
      return this;
    },
  };
  const h = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { h, res };
}

const filter = new ProblemDetailsFilter(
  new AppConfigService(
    parseEnv({
      DATABASE_URL: 'postgres://x',
      NODE_ENV: 'production',
      CLERK_SECRET_KEY: 'k',
      CLERK_AUTHORIZED_PARTIES: 'a',
      CLERK_WEBHOOK_SIGNING_SECRET: 'w',
      CORS_ORIGINS: 'a',
      REDIS_URL: 'redis://x',
      FIREBASE_SERVICE_ACCOUNT_JSON: 'x',
    }),
  ),
);

describe('ProblemDetailsFilter', () => {
  beforeEach(() => jest.mocked(reportException).mockClear());

  it('writes application/problem+json with the request id', () => {
    const { h, res } = host({
      method: 'GET',
      originalUrl: '/api/x',
      headers: {},
      id: 'rid-1',
    });
    filter.catch(new NotFoundException('nope'), h);
    expect(res.statusCode).toBe(404);
    expect(res.contentType).toBe('application/problem+json');
    expect(JSON.parse(res.payload)).toMatchObject({
      status: 404,
      detail: 'nope',
      requestId: 'rid-1',
      instance: '/api/x',
    });
    expect(reportException).not.toHaveBeenCalled();
  });

  it('reports unexpected errors to Sentry with request + user context', () => {
    const { h, res } = host({
      method: 'POST',
      originalUrl: '/api/y',
      headers: {},
      user: { userId: 'u1' },
      route: { path: '/api/y' },
    });
    const boom = new Error('kaput');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    filter.catch(boom, h);
    const body = JSON.parse(res.payload);
    expect(res.statusCode).toBe(500);
    expect(body.detail).toBe('Internal server error');
    expect(typeof body.requestId).toBe('string');
    expect(res.headers['X-Request-Id']).toBe(body.requestId);
    expect(reportException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ requestId: body.requestId, userId: 'u1' }),
    );
  });
});
