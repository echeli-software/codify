import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfigService } from '../config/app-config.service.js';
import { genRequestId } from './request-id.js';

type Req = IncomingMessage & {
  id?: string;
  user?: { userId?: string };
  originalUrl?: string;
};

/**
 * nestjs-pino / pino-http options: structured JSON in production (shipped
 * to Loki per docs/13), pino-pretty single-line output in development.
 * Every line carries the request id (`req.id`, echoed as X-Request-Id) and
 * the internal user id — never tokens, cookies, emails or IPs (docs/14 §17).
 */
export function buildLoggerParams(config: AppConfigService): Params {
  const production = config.isProduction;
  const level = config.get('LOG_LEVEL') ?? (production ? 'info' : 'debug');
  return {
    pinoHttp: {
      level,
      genReqId: (req: IncomingMessage, res: ServerResponse) =>
        genRequestId(req, res),
      transport: production
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
            },
          },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["svix-signature"]',
          'req.headers["stripe-signature"]',
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
      serializers: {
        req: (req: { id?: string; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      customProps: (req: IncomingMessage) => {
        const userId = (req as Req).user?.userId;
        return userId ? { userId } : {};
      },
      customLogLevel: (
        _req: IncomingMessage,
        res: ServerResponse,
        err?: Error,
      ) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        // Load-balancer probes would drown everything else.
        ignore: (req: IncomingMessage) =>
          ((req as Req).originalUrl ?? req.url ?? '').startsWith('/api/health'),
      },
    },
  };
}
