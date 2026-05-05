/**
 * NestJS bootstrap. Loads .env (via dotenv), enables CORS for the student
 * and admin dev origins, and registers a global ValidationPipe so DTOs
 * with class-validator decorators reject malformed bodies before they
 * reach handlers.
 */

import 'reflect-metadata';
import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // Allow the local dev origins of both apps + Storybook.
  app.enableCors({
    origin: [
      'http://localhost:4201',
      'http://localhost:4202',
      'http://localhost:4400',
      'http://localhost:4401',
    ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Query / path params arrive as strings; coerce them to the
      // declared TS types so @IsInt / @Min / @Max validate correctly.
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = process.env.API_PORT || process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
