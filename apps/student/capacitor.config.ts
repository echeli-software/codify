import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the student app (Phase 11, docs/17). The production
 * web build is wrapped by the native shells; NativePlatformService bridges
 * push, network, app state / back button, preferences, haptics and
 * RevenueCat IAP, degrading to no-ops on web.
 *
 *   pnpm exec nx run student:build:production
 *   cd apps/student && npx cap sync          # copy web build + plugins
 *   npx cap open android | npx cap open ios  # Android Studio / Xcode
 *
 * The native projects (android/, ios/) are committed. `pod install` for iOS
 * needs macOS + CocoaPods; Android builds need the Android SDK.
 */
const config: CapacitorConfig = {
  appId: 'app.codify.student',
  appName: 'Codify',
  webDir: '../../dist/apps/student/browser',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
