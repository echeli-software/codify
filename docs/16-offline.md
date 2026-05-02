# 16 — Offline & Sync

The student app is **offline-capable for reading content** once a user has signed in online and downloaded what they want. Sign-in itself always requires connectivity.

## 1. Goals

- A user with an expired token or no connection can still **read previously downloaded lessons** and customize their avatar offline.
- A user can **explicitly download** a course (or selected modules/lessons) for offline use.
- Lesson completions made offline are credited reliably with **no double-counting** when synced.
- Streaks and daily quests are not unfairly broken by short connectivity gaps.
- The user always knows what's downloaded, what's syncing, and what's pending.

## 2. Non-goals

- Offline sign-up or first-time sign-in.
- Offline payment flows.
- Offline submission of code exercises (Judge0 requires connectivity).
- Offline AI prompt grading (server-judged).
- Offline scenario branching with server-side scoring.
- Multi-device live sync (we use last-write-wins reconciliation, not real-time CRDT).

## 3. Capability matrix

| Surface | Online | Offline (post-download) | Offline (no download) |
|---|---|---|---|
| Sign in | ✅ | ❌ blocked, message shown | ❌ same |
| Browse catalog | ✅ | last-fetched cached list | last-fetched cached list |
| Read downloaded lesson | ✅ | ✅ | ❌ |
| Read non-downloaded lesson | ✅ | ❌ "Download to read offline" | ❌ same |
| Quiz lesson | ✅ | ✅ (graded locally; reward queued) | ❌ |
| Exercise lesson (Judge0) | ✅ | ❌ "Connect to run code" | ❌ |
| AI prompt lesson | ✅ | ❌ "Connect to grade" | ❌ |
| Scenario lesson | ✅ | ✅ (graded locally; reward queued) | ❌ |
| Mark lesson complete | ✅ | ✅ (queued) | n/a |
| Update streak | ✅ | ✅ (queued events) | ✅ from queued events |
| Daily quest progress | ✅ | ✅ (recomputed on sync) | ✅ same |
| Avatar dressing room | ✅ | ✅ (re-equip from owned items only) | ✅ same |
| Buy item in shop | ✅ | ❌ "Connect to purchase" | ❌ same |
| Send friend nudge | ✅ | ❌ | ❌ |
| Push notifications | ✅ | ✅ system-delivered; opening goes to last-cached state | ✅ same |

## 4. Sign-in & token semantics

### Initial sign-in
- Always requires connection. Sign-in screen shows a banner if the device is offline: "You need to be online to sign in. Once signed in, you can use Codify offline."
- After successful sign-in, the device is **bonded** to that user — we cache the user id, display name, locale, current avatar config, level, XP, coin balance, owned items list, and active subscription state in IndexedDB so the app can render an authenticated shell offline.

### Token lifecycle
- Clerk JWT is short-lived (~1h); SDK refreshes silently using a long-lived session token.
- **Refresh requires connectivity.** If the device is offline when the JWT expires, we don't try (would fail).
- Offline behavior with expired token:
  - Locally-cached identity remains valid for offline UX, but expires **30 days** after last successful refresh (matching Clerk session max). After that, the app falls back to the sign-in screen even offline; nothing destructive — cached lessons remain on disk, just gated behind sign-in.
  - All API calls queue; nothing is dropped.
  - Banner: "You're offline. Your progress will sync when you're back online."

### Coming back online
1. Detect connectivity (`Capacitor Network` plugin / `online` event on web).
2. Attempt silent token refresh via Clerk SDK.
3. If refresh succeeds → flush sync queue (see §7).
4. If refresh fails (session ended, e.g. revoked or > 30d): show "Please sign in again to sync your progress." Cached read access continues; the **sync queue does not flush** until the same user re-authenticates.
5. After re-sign-in:
   - If `userId` matches cached id → flush queue with new token.
   - If `userId` differs → discard the queue belonging to the previous user (do **not** credit the new user with the old user's offline activity). Show a one-time toast explaining what was discarded so the prior user understands.

### Sign-out
- Available offline; clears all cached user data + sync queue (with a confirmation: "You have unsynced progress. Sign out anyway?").

## 5. Download model (user-facing)

### What you can download
- A whole course.
- A single module within a course.
- A single lesson.
- Suggested: "Download next 3 lessons in this course" auto-prompt after enrollment.

### Where you find it
- **Course detail page**: a "Download" button in the action area.
  - States: `Not downloaded` · `Downloading X%` · `Downloaded` · `Update available` (when source content changed since last download).
- **Module rows**: per-module download icon.
- **Lesson rows**: subtle download dot for downloaded lessons.
- **Settings → Downloads**: full management screen — list of downloaded courses, total storage used, per-course size, last-updated date, "Update" / "Remove" actions, "Remove all" button.

### Download settings
- **Wi-Fi only** toggle (default on for cellular savings; respects Capacitor `Network.connectionType`).
- **Storage budget cap** (default 1 GB; configurable). When approaching, oldest unused downloads are evicted (LRU on `lastReadAt`).
- **Auto-download enrolled courses** (default off). When on: enrolling a course queues download of free + first paid module.
- **Auto-update on Wi-Fi** (default on). Re-fetches changed lessons opportunistically.

### What gets bundled per download
For a course download we fetch and store:

| Asset | Storage | Why |
|---|---|---|
| `LessonDoc` JSON for every downloaded lesson | IndexedDB | Reading content |
| Lesson metadata (title, type, isFree, baseXp, baseCoins, etc.) | IndexedDB | Renders curriculum view |
| Module + course metadata | IndexedDB | Same |
| Inline images referenced by `LessonDoc` (resolved through CDN) | Capacitor Filesystem (mobile) / Cache Storage API (web) | Render lesson without network |
| `ContentTranslation` rows for enabled locale(s) | IndexedDB | Localized read |
| Quiz answer keys for offline grading | IndexedDB (encrypted at rest with a device key) | Local quiz scoring |
| Scenario tree definitions | IndexedDB | Local scenario play |
| Exercise stubs (starter code, visible tests, language) — **not** solutions, **not** hidden tests | IndexedDB | Allow code editing offline; submission queued for online |

We deliberately **do not** ship `Exercise.solutionCode` or `hiddenTestsJson` to clients (online or offline). Those stay server-side.

### Download progress UI
- Progress bar with % + current item ("Caching lesson 4 of 12"), pause / resume, cancel.
- Background continues if the user navigates away (Capacitor Background Tasks; web: best-effort SW fetch).
- Failure handling: per-item retry with backoff; on persistent failure, mark download partial and surface "Retry" affordance.

## 6. Asset caching strategy (beyond explicit downloads)

| Asset class | Strategy | Source of truth |
|---|---|---|
| App shell (HTML/JS/CSS) | Bundled in Capacitor; SW precache on web | Build artifact |
| i18n chrome strings | Cache-first SW; refreshed on app start | `/i18n/<locale>/<chunk>.json` |
| Avatar base + owned item sprites | Eagerly cached on sign-in and on item acquisition; persistent | CDN `/img/<assetId>` |
| Equipped item sprites | Always cached (since a subset of owned) | Same |
| Owned badge icons | Cached on unlock | CDN |
| Sound effects (reward chimes, etc.) | Bundled in app | Build asset |
| Lottie animations (level-up, badge unlock, celebrations) | Bundled in app | Build asset |
| Course covers visible on Today/Catalog | Cache-first, max 50 entries by LRU | CDN |
| Shop catalog thumbnails | Network-first; cache last viewed | CDN |
| Limited-drop hero images | Cache on first view | CDN |

Critical rule: **a signed-in user's avatar must always render offline**. This means base body, current `AvatarConfig`, and all currently `EquippedItem` sprites must be in persistent cache. Eviction skips this set.

## 7. Sync model

### What the client queues offline

A single `OfflineEventQueue` (IndexedDB) of typed events:

```ts
type QueuedEvent =
  | { kind: 'lesson_complete'; userId; lessonId; clientTimestamp; clientEventId; quizScore? }
  | { kind: 'scenario_complete'; userId; lessonId; clientTimestamp; clientEventId; chosenPath; rubricScore }
  | { kind: 'avatar_equip'; userId; slotChanges; clientTimestamp; clientEventId }
  | { kind: 'avatar_config_update'; userId; config; clientTimestamp; clientEventId }
  | { kind: 'lesson_progress_seen'; userId; lessonId; clientTimestamp; clientEventId }
  | { kind: 'preference_update'; userId; prefs; clientTimestamp; clientEventId }
```

Each event has:
- `clientEventId`: UUID v4 generated at event time. Used as the API `Idempotency-Key` on flush.
- `clientTimestamp`: device clock at event time. Used by the server for streak attribution and conflict tiebreaking.

### What is **not** queued
- Code-exercise submissions (require Judge0 → require online).
- AI-prompt grading (require server LLM → online).
- Coin spends (require server-authoritative debit → online).
- Friend / social actions.
- Any payment.

These are explicitly disabled in the UI when offline — see capability matrix.

### Flush sequence
1. Open queue.
2. Order events by `clientTimestamp` ascending.
3. POST each event to its endpoint with `Idempotency-Key: <clientEventId>`.
4. On `2xx`: remove from queue; reconcile UI with returned canonical state (XP, coins, level, streak).
5. On `409 Conflict` (domain-already-applied): remove from queue (server already has this).
6. On `5xx` or network error: keep in queue, exponential backoff, retry next online event.
7. On `401` (token bad): trigger token refresh; if refresh fails, halt and prompt re-sign-in.

Concurrency: only one flush at a time; queue is FIFO. After flush completes, run a single "state reconcile" GET to ensure local mirrors match server.

## 8. Conflict resolution rules

These are the rules that prevent double-counting and weird divergence:

### Lesson completion (most important)
- Server enforces uniqueness on `Progress (userId, lessonId)`.
- First successful completion wins; subsequent completions return the existing reward without re-crediting (`409 Conflict` with the original `Progress` payload).
- Idempotency-Key prevents network-retry double-counts within a single device.
- The unique constraint prevents cross-device double-counts (Device A and Device B both completed offline → whichever flushes first wins; the other gets `409` and removes from queue).
- The non-winning device's UI reconciles to the canonical state and may show a brief "Already completed elsewhere" toast.

### Quiz / scenario re-attempts
- We score every attempt locally and queue the **best** score the user achieved offline since last sync (not every keystroke). One row per `(userId, lessonId, sinceSyncWindow)` in queue; latest write replaces.
- On flush:
  - If server has no completion: completion + score recorded.
  - If server has a completion with a lower `scorePct`: server updates if `clientScorePct > stored.scorePct`.
  - If server has higher score: server keeps server score; client reconciles.

### Avatar equip / config changes
- Last-write-wins by `clientTimestamp`.
- Server stores `lastUpdatedAt` for `User.avatarConfig` and `EquippedItem`. If the queued event's `clientTimestamp < server.lastUpdatedAt`, server ignores (a more recent change happened on another device or the server).
- Client reconciles to server state after flush.

### Streak attribution
- Each completion event carries `clientTimestamp` (the device clock at completion).
- Server normalizes that timestamp to the user's local TZ and decides which "day" it counts for.
- Even if synced 30 minutes after midnight, an event timestamped 23:55 local still satisfies the previous day. (This is what enables fair offline streaks.)
- Anti-abuse: events with `clientTimestamp` more than 24h in the past or any time in the future are clamped to "now"; we log a warning. (Prevents trivially fake clocks; not a security boundary, just a sanity rail.)

### Daily quest progress
- We **do not** queue partial-progress events. We only queue completion-source events (lesson complete, exercise pass, etc.).
- Quest progress is recomputed server-side from the union of synced events. So:
  - Offline: client UI optimistically advances quest progress.
  - On sync: server recomputes from canonical events and reconciles.
- This eliminates a whole category of "client says 4/5, server says 3/5" bugs.

### Coin balance
- Server is the **only** writer.
- Offline UI shows an *estimated* balance based on canonical balance + queued reward events × multiplier-applied-locally.
- Note explicitly displayed: "Estimated — final coins applied when synced." The reconciled balance is what gets shown after flush.
- Local multiplier estimate may be slightly off (e.g. a campaign multiplier the client doesn't know about); reconciliation corrects.

### Friend / social actions
- Disabled offline; no queuing. Avoids stale state ("nudged a friend who blocked me yesterday").

## 9. Storage layout

### Mobile (Capacitor)
- **IndexedDB**: structured data (course/lesson metadata, `LessonDoc` JSON, queue, cached identity, owned-items list, badges).
- **Capacitor Filesystem** (`Directory.Data`): binary/SVG assets (item sprites, lesson images, course covers).
- **Capacitor Preferences**: lightweight settings (theme, locale, reminder time, download settings).
- **SQLite (optional)**: not in v1; consider if IndexedDB perf is insufficient for very large libraries.

### Web (PWA)
- **IndexedDB**: same structured data.
- **Cache Storage API** (via service worker): app shell + image/asset responses.
- **localStorage**: tiny prefs only.
- **OPFS** (Origin Private File System): considered for large asset bundles in the future; v1 sticks with Cache Storage.

### Encryption at rest
- We don't encrypt user content (lessons) — they're already accessible to the user.
- Quiz answer keys are stored with light obfuscation (XOR with a per-device key) to discourage casual cheating, not as a security boundary. The honest path is: server reconciles scores anyway, and rewards are server-credited.

## 10. UX details

### Offline indicator
- Subtle persistent chip in the header when offline ("Offline" with cloud-off icon).
- Tap → sheet listing pending sync items + "Sync now" (manual flush attempt).

### Per-lesson state
- Downloaded lessons show a small download icon in the curriculum.
- Lessons with pending sync show a clock icon ("Will sync when you're online").

### "Sync now" action
- Always available in Settings → Downloads → Sync.
- Tries connectivity check + flush; surfaces results.

### Storage display
- Settings → Downloads:
  - Total app storage used.
  - Per-course breakdown.
  - Eviction policy explanation in plain language.
  - "Free up space" suggestion when 80% of budget consumed.

### First-time download flow
- After enrollment, a small banner: "Want to read this course offline? Download it now." with a one-tap action.
- Skipped if user already enabled auto-download.

### Failed-sync UX
- If sync fails and the user opens the queue, they see what's pending with friendly descriptions ("Lesson 'Hooks' completed yesterday — waiting to sync").
- They can retry, and (last resort) discard a stuck event with a confirm dialog.

## 11. Telemetry

- `download_started`, `download_completed`, `download_failed` (with size, course id, network type).
- `sync_flush_started`, `sync_flush_completed` (events count, duration), `sync_flush_failed`.
- `offline_session_minutes` per session.
- `download_eviction` (which courses LRU'd).
- `queue_depth_on_flush` distribution.

Privacy: aggregate only; not per-user dashboards beyond support tooling.

## 12. Edge cases & decisions

| Case | Decision |
|---|---|
| User installs app on Device B while logged in on Device A; both go offline | Each device independently queues. First to sync wins per-lesson; others get 409. |
| User completes Lesson L offline, then deletes the course download before syncing | Queue is independent of download cache; sync still happens. |
| User uninstalls the app with unsynced events | Events are lost. We surface a one-time confirm before account-level "Sign out" or "Clear data" with unsynced events. App uninstall itself is OS-level; we can't intercept. |
| Storage budget exceeded mid-download | Pause; prompt user to free space or raise budget; remember intent and resume on confirm. |
| User changes locale offline | Allowed; UI flips. Content fallback uses whatever locale was downloaded. |
| User pays / refunds offline | Disabled UI; prompts to come online. |
| Token revoked server-side while offline (e.g. password reset) | Local cache continues until reconnect; on reconnect, refresh fails, re-sign-in prompted; queue blocked until same-user sign-in. |
| Daylight-saving / clock drift | We treat client timestamps as advisory; server clamps wildly off times. Streak attribution uses normalized local TZ. |
| Two devices customizing avatar offline | LWW by `clientTimestamp`; one will win, the other reconciles. |
| Subscription expires while offline | Cached `Subscription` lets app render entitlement; on next sync, server-canonical access enforced. If user happens to consume a paid lesson during a brief offline gap right after expiry, no refund/reversal — the offline data is already on-device and they used it. |

## 13. Implementation phasing

This work is split across two phases:

### Phase 5b — Offline read + queued completions (1.5 weeks; lands right after Phase 5)
- Service worker + IndexedDB plumbing.
- `OfflineEventQueue` with idempotent flush.
- `lesson_complete` queueing + `Progress` unique-constraint enforcement on server.
- Conflict reconciliation (UI handling 409 + state pull).
- Capability gating in UI (disable exercise/AI/shop/social actions offline).
- Token-expired offline behavior.
- Offline indicator + "Sync now" affordance.
- Cached identity bundle on sign-in.

### Phase 8b — Download + asset caching (1 week; folds into Phase 8)
- "Download" UX on course / module / lesson surfaces.
- Storage manager (Settings → Downloads).
- Asset prefetch on sign-in for owned items + avatar config.
- Per-locale content translation prefetch.
- Wi-Fi-only toggle + storage budget cap with LRU eviction.
- Auto-download settings.

These feed naturally into the existing roadmap. See [15-roadmap.md](./15-roadmap.md).
