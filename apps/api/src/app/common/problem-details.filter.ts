import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service.js';
import { buildProblem } from './problem-details.js';
import { requestIdOf } from './request-id.js';
import { reportException } from './sentry.js';

/**
 * Global exception filter: every error leaves the API as RFC 7807
 * `application/problem+json` (see problem-details.ts for the mapping).
 * Unexpected (5xx) errors are logged with their stack and reported to
 * Sentry tagged with the request id, which the client also receives.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly config: AppConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = requestIdOf(req, res);

    const problem = buildProblem(exception, {
      requestId,
      instance: req.originalUrl ?? req.url,
      production: this.config.isProduction,
    });

    if (problem.unexpected) {
      const err =
        exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `${req.method} ${req.originalUrl ?? req.url} → ${problem.status} [${requestId}]: ${err.message}`,
        err.stack,
      );
      reportException(exception, {
        requestId,
        userId: req.user?.userId,
        tags: { route: `${req.method} ${req.route?.path ?? 'unknown'}` },
      });
    }

    if (res.headersSent) return;
    res
      .status(problem.status)
      .type('application/problem+json')
      .send(JSON.stringify(problem.body));
  }
}
