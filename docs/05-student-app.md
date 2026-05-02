# 05 — Student App

Single Ionic + Capacitor + Angular codebase. Three deploy targets:
- **iOS** (App Store)
- **Android** (Play Store)
- **Web/PWA** at `codify.app` (Cloudflare Pages)

Same routes, same components — divergence only via responsive layout and Capacitor-availability checks.

## 1. Responsive philosophy (the non-trivial bit)

Ionic is mobile-optimized by default. To make the web experience comfortable on big screens, we apply three rules:

1. **AppShell adapts**: tabs at the bottom on mobile, transformed into a left sidebar at `md` (768px+); a header bar appears on desktop with breadcrumb + global search + avatar/level summary.
2. **Content is bounded**: every route has `max-width: 720px` for reading content and `max-width: 1280px` for grid screens (catalog, shop, leaderboard). Centered with adaptive gutters. No edge-to-edge text on a 27" monitor.
3. **Multi-column where it pays**: catalog → 1 col mobile, 2 col `sm`, 3 col `md`, 4 col `lg`. Lesson player stays single-column even on desktop (reading is single-column). Shop → 2 col mobile, 4 col `md`, 6 col `lg`. Inventory → grid scales similarly.

We **do not** build a separate web layout. Same components, responsive directives, breakpoint-aware containers from `ui-ionic`.

### Breakpoints (from `ui-tokens`)
| Token | Min width |
|---|---|
| `xs` | 0 |
| `sm` | 480px |
| `md` | 768px |
| `lg` | 1024px |
| `xl` | 1280px |
| `xxl` | 1536px |

### Specific responsive treatments
- **Bottom tabs → side rail**: `<ion-tab-bar slot="bottom">` shown `< md`; sidebar nav shown `≥ md`. Implemented with a single `AppShell` organism that swaps internally.
- **Lesson player**: side rail with module outline appears `≥ lg`; on smaller screens, outline lives behind a hamburger button.
- **Bottom sheets → side panels**: `BottomSheet` molecule renders as `<ion-modal>` on mobile, as a side `Drawer` (right-edge) on `≥ md`.
- **Avatar / dressing room**: avatar canvas on the left, item grid on the right at `≥ md`; stacked on mobile.
- **Typography scales** with breakpoint via fluid type tokens (CSS `clamp()`).
- **Hover states** only for `(hover: hover)` — never on touch.

## 2. Navigation map

```
Tabs (mobile) / Sidebar (desktop)
├── Today          (home / next-up)
├── Learn          (catalog → course → lesson)
├── Avatar         (dressing room)
├── Shop
└── Profile
        └── (drawer / sub-routes)
            ├── Inventory
            ├── Friends
            ├── League
            ├── Subscription
            ├── Achievements
            ├── Settings
            └── Sign out
```

Notifications bell (top-right on desktop, `Today` header on mobile) opens an in-app inbox.

## 3. Screens

### Onboarding (first launch only)
1. **Welcome carousel** (3 slides, swipeable; auto-advance on tap).
2. **Goal picker**: "Why are you here?" — career change / new tech / AI tooling / soft skills. Recorded; influences first-recommended courses.
3. **Track picker**: top-3 recommended courses based on goal. Pick one to start (others suggested later).
4. **Schedule**: choose daily reminder time (default 8 PM local).
5. **First lesson**: launches the first lesson of the chosen course; lesson is short and winnable.
6. **First reward**: lesson complete → coin + XP shower → unlock first cosmetic item (free starter pet) → invite to name pet → return to Today.

Total: ≤ 60 seconds to first reward (excluding lesson read time). Skip allowed at any step except sign-in.

### Today
- Greeting with user's display name, current streak chip (with freezes), level + XP bar.
- "Continue learning" card — last lesson resume button.
- Daily quests (3 cards with progress bars).
- "Recommended next" — 1–3 lessons based on track + drop-off prediction.
- League rank widget (current tier, current rank, time-to-reset).
- Coin balance + "Open shop" link.
- Friends activity feed (opt-in; small).

### Learn → Catalog
- Search bar (debounced; queries courses + categories).
- Filter chips (categories, difficulty, free-trial-available, premium-only, language).
- Sort: recommended, newest, most popular, shortest.
- Course cards with cover, title, category chips, lesson count, duration, "free preview available" badge, "included in [Plan]" mini chip.

### Learn → Course detail
- Hero: cover, title, author, difficulty, duration, total lessons.
- Action: "Continue" (if enrolled) or "Start free preview" (if free lessons exist) or "Subscribe to start" (paywalled).
- "Plans that include this course" chips (each a tappable detail).
- Curriculum: collapsible modules → lessons. Free lessons marked clearly. Premium lessons show a small lock with the cheapest plan that unlocks them.
- Reviews / ratings (later phase).
- Related courses.

### Learn → Lesson player
- Header: progress in module, "Exit" (with confirm if unsaved), settings (text size, audio toggle).
- Body: `LessonBlockRenderer` rendering the `LessonDoc` JSON.
- For interactive blocks: inline within the flow.
- Footer (sticky): "Mark complete" / "Next" once read; "Submit" / "Run" for exercise-type lessons.
- On complete: optimistic UI + reward orchestration → navigate to next lesson or course summary.

### Learn → Quiz / Exercise / Scenario
Each lesson type has a dedicated runner:
- **Quiz**: question, options (radio/checkbox/match), immediate feedback per question. Score stored as `Progress.scorePct`.
- **Exercise** (`ExerciseRunner`): Monaco editor (themed), visible tests panel, "Run" (visible only) and "Submit" (all tests). Verdict UI animates in. Hidden tests reveal after pass.
- **AI prompt** (`AiPromptPlayground`): user composes a prompt, submits. Server runs against a graded rubric (deterministic checks first; LLM-judged later). Rubric items light up green as criteria are met.
- **Scenario** (`ScenarioRunner`): branching dialogue with choices; outcome scored on a rubric; can replay with different choices.

### Avatar (dressing room)
- Live-rendered avatar in center.
- Slot picker on the left (`md+`) or top tabs (mobile): pet, hair, top, bottom, shoes, hat, glasses, accessory, frame, background, emote.
- Item grid on the right (`md+`) or below (mobile): owned items per slot. Tap to preview, swipe to revert.
- "Save" persists `EquippedItem` rows.
- "Browse shop for [slot]" link.

### Shop
- Tabs / chip filters by item category.
- Filter by rarity, affordability, premium-only, limited-drop.
- Item card: thumbnail, name, rarity glow, cost (with affordability check), required level if any.
- Limited-drop section pinned at top with countdown.
- Item detail sheet (bottom on mobile, side on desktop): big preview, full description, "Try on" (preview on dressing room without buying), "Buy" CTA with coin balance check.
- After buy: coin debit animation + unlock toast + offer to equip immediately.

### Inventory
- Grouped by slot, then by acquisition date.
- Equip / unequip per item; multi-select bulk equip set.

### League
- Current tier badge, week countdown.
- Leaderboard table (virtualized, current user pinned to bottom or own row highlighted).
- Promotion / relegation thresholds visualized.
- Past weeks history.

### Friends
- Friends list with quick "nudge" (sends `FRIEND_NUDGE` notification) and "compare" (mini side-by-side stats).
- Add by email / by share link (`?ref=<userId>`).
- Friend requests inbox.

### Profile
- Public profile preview (what others see).
- Stats: total XP, level, longest streak, courses completed, badges, items owned.
- Achievements / badges grid.

### Subscription
- Current plan card (or "Free" placeholder with primary CTA).
- "Upgrade" → plan picker with comparison.
- Manage payment method → Stripe Customer Portal in `<ion-modal>` with in-app browser fallback.
- Billing history.
- Cancel subscription (no dark patterns: single-screen confirm with "you'll keep access until [date]").

### Settings
- Account (Clerk-managed link).
- Language (also accessible globally).
- Theme: system / light / dark.
- Notifications: per-channel toggles, reminder time, "fewer like this" feedback per kind.
- Reduced motion / reduced sound toggles.
- Data & privacy (export, delete).
- Help / support / about.

### Notifications inbox
- In-app feed of recent notifications.
- Read / unread, group by day.
- Per-notification quick action (e.g. "Open daily quest", "Send back nudge").

## 4. Lesson rendering & gating

`LessonPlayer` resolves access via `libs/domain/access.canUserAccessLesson`. If denied:
- Show `PaywallSheet` (slide up on mobile, side panel on desktop).
- List the cheapest plans that include this course.
- "Start free preview" if any lesson in the course is free and not yet completed.

Gating decisions are *displayed* on the client but *enforced* server-side. The lesson `contentJson` is never sent to a client without access; preview content for paywalled lessons is a teaser placeholder.

## 5. Offline behavior

Full spec in [16-offline.md](./16-offline.md). Highlights:

- **Sign-in always requires connection.** After first online sign-in, the device is "bonded" to the user; offline use works thereafter.
- **Download** lessons explicitly via course / module / lesson UI, or auto-download via Settings → Downloads. Downloaded content includes `LessonDoc` JSON, inline images, quiz keys, scenario trees, and exercise stubs (never reference solutions or hidden tests).
- **Reading + quiz + scenario** lessons work offline (graded locally; rewards queued).
- **Exercise + AI prompt + shop + payments + social** require connection; UI clearly disables those actions offline.
- Reward events queued in `OfflineEventQueue` (IndexedDB) and flushed on reconnect with idempotency keys; server enforces uniqueness on `Progress (userId, lessonId)` to prevent double-credit across devices.
- **Streak grace**: completion events carry `clientTimestamp`; server normalizes to user-local TZ — a 23:55 local completion synced at 00:30 still counts for the prior day.
- **Token expired offline**: cached identity stays valid for offline reads; sync queue holds until same-user re-sign-in. If a *different* user signs in, the queue is discarded with an explanatory toast.
- **Asset caching**: avatar (config + equipped items + base body) is always cached so the user's identity renders offline, even after eviction of older course downloads.
- **Storage manager** (Settings → Downloads): per-course size, total used vs budget, Wi-Fi-only and auto-update toggles, LRU eviction.

## 6. Animations & feedback

Everything routes through `RewardOrchestrator`. The canonical event → visual / sound / haptic mapping lives in [10-engagement.md §4](./10-engagement.md). API surface and timeline live in [03-shared-libraries.md](./03-shared-libraries.md). Both `prefers-reduced-motion` and the per-user "reduced sound" flag are honored.

## 7. Capacitor surface

| Plugin | Use |
|---|---|
| Haptics | All reward events on iOS/Android |
| Push Notifications | Streak reminder, daily quest, friend nudge, league result, item drop, billing |
| Local Notifications | Backup for push if the user disables remote |
| App | Background / foreground state for streak grace + telemetry |
| Network | Offline detection |
| Preferences | Local cache of UI prefs |
| Browser | Open Stripe Customer Portal in in-app browser |
| Filesystem | Optional offline lesson cache (large) |
| StatusBar / SplashScreen | Theme-aware |

Web fallbacks: every Capacitor call wrapped in `libs/ui-ionic/platform.ts` so calls no-op or fall back gracefully on web.

## 8. In-app purchases (later)

Apple and Google require their billing for digital subscriptions inside their apps. We will integrate **RevenueCat** to unify Stripe (web) + StoreKit + Play Billing under one entitlement, mirrored to our `Subscription` table via webhook. Architectural prep: `Subscription.source` enum (deferred to phase 11) so our access logic remains payment-provider-agnostic.

## 9. Telemetry

- Page views, screen time per route.
- Funnel events: `onboarding_step_complete`, `lesson_started`, `lesson_completed`, `exercise_submit`, `paywall_shown`, `paywall_cta_tap`, `subscribe_started`, `subscribe_succeeded`.
- Reward events emitted by the orchestrator (kind, xp, coins, multiplier, breakdown).
- Latency: TTFB to API, time-to-render lesson, animation FPS sample.

## 10. Out of scope (initial)

- Live chat / cohort chat (defer; brings moderation cost).
- User-generated lessons.
- Course downloads as a marketed feature (offline reading is a happy side effect, not promoted).
- Apple Watch / Wear OS companions.
- Tablet-specific layouts beyond responsive breakpoints (tablet uses desktop layout).
