import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the student app (Phase 11). The web build is wrapped
 * by the native shells; NativePlatformService bridges haptics, push, and
 * RevenueCat IAP, degrading to no-ops on web.
 *
 *   Add platforms (needs Xcode / Android SDK — deferred, store-side):
 *     npx cap add ios
 *     npx cap add android
 *     npx cap sync
 */
const config: CapacitorConfig = {
  appId: 'app.codify.student',
  appName: 'Codify',
  webDir: '../../dist/apps/student/browser',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
