import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the student app. Native iOS/Android platforms are
 * not added until Phase 11 (per docs/15-roadmap.md); for now this file
 * documents the eventual app id + name and the web build location.
 *
 *   To add platforms when Phase 11 lands:
 *     npx cap add ios
 *     npx cap add android
 */
const config: CapacitorConfig = {
  appId: 'app.codify.student',
  appName: 'Codify',
  webDir: '../../dist/apps/student/browser',
  server: {
    androidScheme: 'https',
  },
};

export default config;
