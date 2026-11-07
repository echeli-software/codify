# 17 — Mobile builds + native IAP (Phase 11)

Store presence (iOS + Android via Capacitor) and native billing through
RevenueCat, layered onto the existing PWA without forking the codebase. The
web build is the single source; the native shells wrap it and the
`NativePlatformService` bridges the device-only capabilities, degrading to
no-ops on web.

## What shipped (software, verified locally)

### RevenueCat → Subscription → access (acceptance #1)

RevenueCat is the cross-store IAP layer: store products mirror our Stripe
plans, and its **entitlement webhook** is the source of truth that syncs store
purchases into the **same `Subscription` mirror** Stripe writes to. Because
`AccessService` resolves access purely from `Subscription` rows (it never looks
at the source), a synced store purchase grants access with zero extra wiring —
identical to a Stripe-web subscription.

- `POST /webhooks/revenuecat` (public; auth via the configured Authorization
  secret in prod, `DevRevenueCatProvider` trusts JSON in dev).
- Event handling: `INITIAL_PURCHASE` / `RENEWAL` / `PRODUCT_CHANGE` /
  `UNCANCELLATION` → upsert an active subscription; `CANCELLATION` →
  `cancelAtPeriodEnd`; `EXPIRATION` → `CANCELED` + close the period;
  `BILLING_ISSUE` → `PAST_DUE`.
- **Identity:** idempotent on the RevenueCat event id; identity-stable on the
  store `original_transaction_id` (survives renewals) so renewals update the
  same row.
- **Mapping:** `Plan.revenueCatEntitlementId` maps an entitlement back to a
  plan (settable via the admin plans API).
- Schema: `Subscription.stripeSubscriptionId/stripeCustomerId` nullable;
  `revenueCatUserId` / `storeTransactionId` / `storeProductId` added.

### Push notifications (acceptance #2, software side)

- `DeviceToken` model; the student app registers its token on login via
  `POST /devices` (native only).
- `PushProvider` seam (FCM/APNs in prod; `DevPushProvider` captures deliveries
  for verification locally).
- `StreakReminderService`: targets users with an active streak who haven't
  acted **today in their own timezone**, sends a localized (pt-BR/en) reminder,
  and prunes tokens the provider reports invalid. Cron in prod; admin-triggered
  via `POST /notifications/streak-reminder/run` for verification.

### Push on device: FCM on iOS + Android (as built)

The app uses **`@capacitor-firebase/messaging`** on both platforms, so the
token sent to `POST /devices` is always an **FCM registration token** — the
only kind the API's `FcmPushProvider` delivers to (iOS through FCM's APNs
bridge). `@capacitor/push-notifications` was removed: it returns a raw APNs
token on iOS and the plugin documents that the two must not be installed
together.

`NativePushService` (`apps/student/src/app/native/native-push.service.ts`):

- **Boot** (`NativePlatformService.init`): listeners for notification taps
  (also on a cold start), foreground messages and token refresh.
- **Sign-in**: permission prompt only while undecided (`checkPermissions` →
  `requestPermissions`; a denial is respected) → `getToken` → `POST /devices`
  with `IOS` / `ANDROID` (one retry on 409 `device.rebind_required`).
- **Token refresh** (`tokenReceived`): the new token is bound, then the old
  one is unregistered.
- **Foreground**: iOS shows the banner itself (`presentationOptions` in
  `capacitor.config.ts`); Android shows an in-app toast with an "Open" action
  when the message has a deep link.
- **Tap**: opens the route from the data payload — `deepLink`, else `url`
  (what `NotificationService` sends), else `route`, else the FCM `link`. Only
  app-relative paths (or absolute URLs on the app's own origin) are followed.
- **Sign-out**: `DELETE /devices/:token` + `deleteToken()`, so the next account
  on the device gets a fresh token.
- The plugin is registered by name with `@capacitor/core` (types only from the
  package), so its web implementation and the Firebase JS SDK never enter the
  web bundle.

#### Push setup (needs real accounts — never commit these files)

1. **Firebase project**: add an iOS app (bundle id `app.codify.student`) and an
   Android app (package `app.codify.student`).
2. **Android**: download `google-services.json` into
   `apps/student/android/app/` (the Gradle build applies the
   google-services plugin only when the file exists).
3. **iOS**: download `GoogleService-Info.plist`, add it to the **App** target
   in Xcode (`apps/student/ios/App/App/`); enable the **Push Notifications**
   capability (adds `aps-environment` to the entitlements) — Background Modes
   → Remote notifications is already on. `AppDelegate.swift` already forwards
   the APNs token / background messages to the plugin. Run `pod install`
   (`npx cap sync ios`) on macOS.
4. **APNs key**: Apple Developer → Keys → create an APNs auth key (.p8) and
   upload it in Firebase → Project settings → Cloud Messaging → Apple app
   configuration (Key ID + Team ID).
5. **API**: set `FIREBASE_SERVICE_ACCOUNT_JSON` (base64 service-account JSON,
   see `.env.example`) so `FcmPushProvider` replaces the dev provider.
6. Both files and the key are secrets/config per environment — keep them out
   of git (CI injects them before `cap sync`).

### Lesson images offline on device

Course downloads store lesson images on the device filesystem in the native
shell (no service worker there) and render them from the local copy — see
docs/16 §9 "As built (native lesson images)".

### Capacitor + native bridge

- `apps/student/capacitor.config.ts` (app id, web dir, push presentation).
- `NativePlatformService`: feature-detects the Capacitor runtime and bridges
  push registration (via `NativePushService`) + RevenueCat purchase/restore via indirected dynamic
  `import()` (so the web bundle never resolves native-only plugins).
- Subscription page: on native, subscribing routes through store IAP (App Store
  / Play forbid linking out to web payment for digital goods) and a "Restore
  purchases" button is shown (store requirement). Web behavior is unchanged.
- **Haptics** for reward events were already wired (`HapticsService` →
  `RewardOrchestrator`, with a `navigator.vibrate` web fallback).

## Verification

- `tools/scripts/probes/phase-11a-revenuecat.mjs` — 15 assertions: no-access →
  IAP purchase → access GRANTED, renewal extends in place, duplicate dropped,
  expiration revokes, malformed → 400.
- `tools/scripts/probes/phase-11b-push.mjs` — 12 assertions: register →
  at-risk device reminded, control (acted today) not reminded, stale token
  pruned, unregister.
- `tools/scripts/probes/phase-11-browser.mjs` — 5 assertions: "Restore
  purchases" hidden on web, shown under an injected Capacitor runtime.
- Ledger drift-free; all builds + 13 test projects green.

## Deferred — needs real infra / store accounts (not doable in a dev build)

These are genuinely store-side and cannot run without signing identities,
store-console accounts, and physical devices:

- **Signed native builds in CI** — `npx cap add ios/android` + Xcode / Android
  SDK, signing certs, provisioning profiles, fastlane.
- **TestFlight + Play Internal Testing** distribution.
- **Real APNs/FCM delivery** to physical devices (the `PushProvider` /
  `FcmPushProvider` real implementation + service-account keys).
- **Real RevenueCat dashboard** wiring (products, entitlements, the production
  Authorization secret) + the `RevenueCatHttpProvider` is implemented but
  unexercised without live store sandbox purchases.
- **Store listings** (icon, screenshots, description, ratings, privacy
  disclosure) and **App Store / Play submission + approval** (acceptance #3).

The seams are all in place so the real providers/keys drop in behind env vars
(`REVENUECAT_WEBHOOK_AUTH`, `FCM_SERVICE_ACCOUNT`) without touching callers.
