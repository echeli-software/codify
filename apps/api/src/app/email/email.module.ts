import { Module } from '@nestjs/common';
import {
  EMAIL_LINKS,
  createEmailLinks,
  createEmailProvider,
  createUnsubscribeTokens,
} from './email-config.js';
import { EMAIL_PROVIDER } from './email.provider.js';
import { EmailService } from './email.service.js';
import { EmailUnsubscribeController } from './email-unsubscribe.controller.js';
import { UNSUBSCRIBE_TOKENS } from './unsubscribe-token.js';

/**
 * Transactional email: provider (Resend in prod, capturing dev provider
 * locally), templates, signed unsubscribe links + the public unsubscribe
 * endpoint. Sending policy (preferences, dormancy, delivery log) lives in
 * NotificationService.
 */
@Module({
  controllers: [EmailUnsubscribeController],
  providers: [
    EmailService,
    { provide: EMAIL_PROVIDER, useFactory: () => createEmailProvider() },
    {
      provide: UNSUBSCRIBE_TOKENS,
      useFactory: () => createUnsubscribeTokens(),
    },
    { provide: EMAIL_LINKS, useFactory: () => createEmailLinks() },
  ],
  exports: [EmailService, EMAIL_PROVIDER],
})
export class EmailModule {}
