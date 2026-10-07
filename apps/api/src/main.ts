/**
 * NestJS bootstrap.
 *
 *  1. Load .env (dotenv) and validate the environment (zod) — a bad config
 *     exits with every invalid/missing variable listed.
 *  2. Sentry (when SENTRY_DSN is set), pino structured logging.
 *  3. Hardening: helmet, CORS allowlist (CORS_ORIGINS), `trust proxy` for
 *     Cloudflare, raw body kept for webhook signature checks (Stripe +
 *     Clerk read `req.rawBody`), graceful shutdown hooks.
 *  4. Global ValidationPipe with structured (problem+json) 400s.
 */

import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { initSentry } from './app/common/sentry.js';
import { validationExceptionFactory } from './app/common/validation.js';
import { AppConfigService } from './app/config/app-config.service.js';
import { EnvValidationError } from './app/config/env.schema.js';
import { loadEnv } from './app/config/env.js';

async function bootstrap() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  initSentry(env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  // Lesson docs are validated up to 500 KB (lessons service → 413 above);
  // Express's 100 KB default would reject them before validation runs.
  app.useBodyParser('json', { limit: '1mb' });
  const config = app.get(AppConfigService);

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // Cloudflare (and Coolify's proxy) sit in front: trust their
  // X-Forwarded-For so req.ip / rate-limit trackers see the real client.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // JSON API: no HTML is served, so a strict CSP costs nothing.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      // Bearer-token API (no cookies): let the Capacitor app (capacitor://
      // localhost) and CDN-hosted apps load API-served resources.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Query / path params arrive as strings; coerce them to the
      // declared TS types so @IsInt / @Min / @Max validate correctly.
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.enableShutdownHooks();

  const port = config.port;
  await app.listen(port);
  app
    .get(Logger)
    .log(
      `Application is running on: http://localhost:${port}/${globalPrefix}`,
      'Bootstrap',
    );
}

bootstrap();
