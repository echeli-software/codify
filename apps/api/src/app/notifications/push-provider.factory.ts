import { Logger } from '@nestjs/common';
import type { AppConfigService } from '../config/app-config.service.js';
import { FcmPushProvider } from './fcm-push.provider.js';
import { DevPushProvider, type PushProvider } from './push.provider.js';

/**
 * Selects the push transport: FCM (firebase-admin) when
 * FIREBASE_SERVICE_ACCOUNT_JSON is set, the capturing DevPushProvider
 * otherwise. Production without FCM credentials fails at boot.
 */
export function createPushProvider(config: AppConfigService): PushProvider {
  const sa = config.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (sa) return FcmPushProvider.fromServiceAccount(sa);
  if (config.isProduction) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is required in production (FCM push delivery).',
    );
  }
  new Logger('NotificationsModule').log(
    'FIREBASE_SERVICE_ACCOUNT_JSON unset — using DevPushProvider',
  );
  return new DevPushProvider();
}
