import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { buildProblem } from './problem-details.js';
import { validationExceptionFactory } from './validation.js';

const opts = { requestId: 'req-1', instance: '/api/x', production: true };

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`boom ${code}`, {
    code,
    clientVersion: '7.8.0',
  });
}

describe('buildProblem', () => {
  it('maps a string HttpException to problem+json fields', () => {
    const p = buildProblem(new NotFoundException('Course not found'), opts);
    expect(p.status).toBe(404);
    expect(p.unexpected).toBe(false);
    expect(p.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Course not found',
      code: 'not_found',
      instance: '/api/x',
      requestId: 'req-1',
    });
  });

  it('keeps extra body fields of the lesson-complete 409 (offline sync relies on them)', () => {
    const p = buildProblem(
      new ConflictException({
        message: 'Lesson already completed',
        statusCode: 409,
        progress: { lessonId: 'l1', xpAwarded: 10 },
        totals: { totalXp: 10, coins: 5 },
      }),
      opts,
    );
    expect(p.body.status).toBe(409);
    expect(p.body.detail).toBe('Lesson already completed');
    expect(p.body['progress']).toEqual({ lessonId: 'l1', xpAwarded: 10 });
    expect(p.body['totals']).toEqual({ totalXp: 10, coins: 5 });
    expect(p.body).not.toHaveProperty('statusCode');
    expect(p.body).not.toHaveProperty('message');
  });

  it('keeps reason + requiredPlans on the 402 paywall', () => {
    const p = buildProblem(
      new HttpException(
        {
          statusCode: 402,
          message: 'Subscription required',
          reason: 'paywall',
          requiredPlans: [{ id: 'p1' }],
        },
        402,
      ),
      opts,
    );
    expect(p.body).toMatchObject({
      status: 402,
      code: 'payment_required',
      detail: 'Subscription required',
      reason: 'paywall',
      requiredPlans: [{ id: 'p1' }],
    });
  });

  it('never lets extras overwrite requestId/status', () => {
    const p = buildProblem(
      new BadRequestException({
        message: 'x',
        requestId: 'spoof',
        status: 200,
      }),
      opts,
    );
    expect(p.body.requestId).toBe('req-1');
    expect(p.body.status).toBe(400);
  });

  it('surfaces structured validation errors', () => {
    const ex = validationExceptionFactory([
      {
        property: 'take',
        constraints: { min: 'take must not be less than 1' },
        children: [],
      },
      {
        property: 'profile',
        children: [
          {
            property: 'name',
            constraints: { isString: 'name must be a string' },
            children: [],
          },
        ],
      },
    ]);
    const p = buildProblem(ex, opts);
    expect(p.body.code).toBe('validation.failed');
    expect(p.body.errors).toEqual({
      take: ['take must not be less than 1'],
      'profile.name': ['name must be a string'],
    });
    expect(p.body.detail).toBe(
      'take must not be less than 1; name must be a string',
    );
  });

  it('maps 429 to rate_limited', () => {
    expect(buildProblem(new ThrottlerException(), opts).body.code).toBe(
      'rate_limited',
    );
  });

  it.each([
    ['P2025', 404, 'not_found'],
    ['P2002', 409, 'conflict.unique'],
    ['P2003', 400, 'invalid_reference'],
  ])('maps Prisma %s to %i', (code, status, problemCode) => {
    const p = buildProblem(prismaError(code), opts);
    expect(p.status).toBe(status);
    expect(p.body.code).toBe(problemCode);
    expect(p.unexpected).toBe(false);
    expect(p.body.detail).not.toContain('boom');
  });

  it('treats other Prisma errors as unexpected 500s', () => {
    const p = buildProblem(prismaError('P1001'), opts);
    expect(p.status).toBe(500);
    expect(p.unexpected).toBe(true);
  });

  it('hides internal messages of unknown errors in production, with a request id', () => {
    const p = buildProblem(new Error('secret db detail'), opts);
    expect(p.status).toBe(500);
    expect(p.unexpected).toBe(true);
    expect(p.body.detail).toBe('Internal server error');
    expect(p.body.requestId).toBe('req-1');
    expect(JSON.stringify(p.body)).not.toContain('stack');
  });

  it('keeps the message (never the stack) of unknown errors outside production', () => {
    const p = buildProblem(new Error('debuggable'), {
      ...opts,
      production: false,
    });
    expect(p.body.detail).toBe('debuggable');
    expect(JSON.stringify(p.body)).not.toContain('at ');
  });

  it('keeps intentional 5xx HttpException messages', () => {
    const p = buildProblem(
      new ServiceUnavailableException('AI grading unavailable'),
      opts,
    );
    expect(p.status).toBe(503);
    expect(p.unexpected).toBe(true);
    expect(p.body.detail).toBe('AI grading unavailable');
  });

  it('maps exposed http-errors (body-parser) to their 4xx status', () => {
    const err = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      expose: true,
    });
    const p = buildProblem(err, opts);
    expect(p.status).toBe(400);
    expect(p.body.detail).toBe('Unexpected token');
  });
});
