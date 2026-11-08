import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the student app (Phase 11, docs/17). The production
 * web build is wrapped by the native shells; NativePlatformService bridges
 * FCM push, network, app state / back button, preferences, haptics and
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
    // FCM push on iOS + Android (@capacitor-firebase/messaging). iOS shows
    // foreground notifications natively with these options; Android
    // foreground messages become an in-app toast (NativePushService).
    // Needs GoogleService-Info.plist / google-services.json — see
    // docs/17-mobile.md §Push setup.
    FirebaseMessaging: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // The app hides the splash as soon as it has booted
    // (NativeShellService.hideSplash); the auto-hide is only a safety net.
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: true,
    },
    // Backup daily reminder when remote push is off (docs/05 §7).
    LocalNotifications: {
      iconColor: '#5b8def',
    },
  },
};

export default config;
