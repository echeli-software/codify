# 10 — Engagement

Engagement is the product. This doc collects the practices applied across the app so they can be reviewed as a system.

## 1. Loops

### Hourly micro-loop (within a session)

Reading → quiz → small reward → reading → small reward → micro-celebration on milestones (e.g. every 3 lessons within a session).

### Daily loop

Open app → see streak status, daily quests, "continue" → complete one lesson → reward + quest progress → optional second lesson → close.

### Weekly loop

League rank visible from Today → finish strong on Sunday → promote/demote → freeze earned for streak insurance → next week starts.

### Monthly loop

Limited drop event (~once per month) → driven by push + banner → casual return for users who lapsed mid-month.

### Yearly loop

Streak milestones at 30/100/365 days → exclusive cosmetics + flair.

## 2. Onboarding (full sequence)

| Step                        | Goal                | Anti-friction                                       |
| --------------------------- | ------------------- | --------------------------------------------------- |
| Sign-in (Clerk)             | Auth                | Magic link + Google + Apple. Phone optional.        |
| Welcome carousel (3 slides) | Tone-set            | Skip allowed; auto-advance.                         |
| Goal picker                 | Personalization     | Single tap per choice; "Other" allowed.             |
| Track picker                | Commit to direction | 3 recommendations; pick first; can change later.    |
| Schedule                    | Daily reminder      | Pre-fill 8 PM local; one tap to confirm.            |
| First lesson                | First success       | Short reading + 1 quiz, designed to take ≤ 4 min.   |
| First reward                | Endowment           | Coin shower + first cosmetic gift + name your pet.  |
| Tour overlay (optional)     | Orient              | Two highlights: "your streak", "your daily quests". |
| Day-2 push                  | Return              | Personalized to schedule. "[Pet name] is waiting."  |

**60-second rule**: from app open to first reward, ≤ 60s of UI time excluding lesson reading. Test continuously.

## 3. Notifications

### Channels

- **Push** (FCM/APNs via Capacitor; web push for PWA users).
- **Email** (transactional via Postmark/Resend).
- **In-app inbox** (always; persisted on `Notification`).

### Default cap

- ≤ **2 push/day** per user. Configurable per user up or down.
- Email used sparingly: welcome, billing, weekly recap (opt-in default).
- In-app inbox unlimited (user-pull, not push).

### Quiet hours

- Stored on `User.quietHoursStart` / `quietHoursEnd` (minutes-from-midnight, user-local). `Null` = use defaults.
- **Default**: 22:00–08:00 user-local.
- All push respects quiet hours except `SYSTEM`. If a non-SYSTEM push would fire inside the window, it's deferred to the window's end.
- User-editable in Settings → Notifications.

### Default kinds & timing

| Kind              | Channel                          | Default trigger                                                 | Quiet hours                 |
| ----------------- | -------------------------------- | --------------------------------------------------------------- | --------------------------- |
| `STREAK_REMINDER` | Push                             | 2h before user-local midnight if no completion today            | Respect quiet hours setting |
| `DAILY_QUEST`     | Push                             | 30min after user's typical session start time, if no completion | Respect quiet hours         |
| `FRIEND_NUDGE`    | Push (rate-limited 1/friend/day) | When a friend nudges                                            | Respect quiet hours         |
| `LEAGUE_RESULT`   | Push                             | Monday 09:00 user-local                                         | Respect quiet hours         |
| `ITEM_DROP`       | Push                             | At drop start (subject to opt-in)                               | Respect quiet hours         |
| `PROMO`           | Push                             | Campaign start (subject to opt-in, default off)                 | Respect quiet hours         |
| `BILLING`         | Push + Email                     | On payment failure / before renewal (PIX)                       | Respect (email anytime)     |
| `SYSTEM`          | Push                             | Critical (account suspended, terms update)                      | No quiet-hours override     |

### Time-of-day learning

- We track session-start times. After 7 days of data, the daily quest reminder shifts to a personalized window.
- Default before learned: 8 PM local.

### Per-kind opt-out + "fewer like this"

- Settings allows per-kind toggle.
- Each notification has a small "fewer like this" affordance that decreases the kind's frequency.

### Anti-spam guarantees

- A user can never receive 2 push within 30 minutes.
- Across all kinds, never more than 14/week without explicit opt-in.
- We never push "we miss you" lapsed-user spam without a content reason.

### Implementation (API contract)

- **Entry point**: `NotificationService.notify(userId, { kind, title, body, deepLink?, action?, data? }, { channels?, respectQuietHours?, now? })`
  (`apps/api/src/app/notifications/`). It always writes the `IN_APP` row (the inbox), then delivers push through
  `PushService` for push kinds and email for email kinds, and logs `PUSH` / `EMAIL` rows (`sentAt`, or
  `scheduledFor` while a push waits for quiet hours to end — the same row gets `sentAt` on delivery, or is deleted
  if the push is skipped then). Copy is built per recipient locale (pt-BR / en-US). Friend nudges, league results,
  item drops, streak reminders and billing notices all go through it. Push payloads carry `data.url` (deep link),
  `data.kind` and `data.notificationId`.
- **Channels per kind**: push — every kind except `WELCOME` / `WEEKLY_RECAP`; email — `WELCOME`, `BILLING`,
  `WEEKLY_RECAP`, `REACTIVATION`, `SYSTEM`. Dormant (§13) and suspended users only get `BILLING` (+ `SYSTEM`)
  push/email; the inbox row is still written.
- **Push rules** (`PushService.sendToUser`, in order): per-kind `pushEnabled` → devices → quiet hours (deferred
  on the `push-deferred` queue) → "fewer like this" (level 1: ≤ 1 push of the kind per 2 days, level 2: per 7 days)
  → ≤ 14 non-SYSTEM pushes per user-local ISO week unless `User.pushWeeklyOptIn` (counted from the PUSH log) →
  the user's daily cap `User.pushDailyCap ?? 2` (0 = no non-SYSTEM push) and ≥ 30 min spacing (Redis). `SYSTEM`
  bypasses everything; `SYSTEM` and `BILLING` can never be disabled.
- **Preferences**: `NotificationPreference` row per kind; no row = defaults (all on, `PROMO` push off).
- **Email**: `EMAIL_PROVIDER` — Resend over HTTP when `RESEND_API_KEY` + `EMAIL_FROM` are set, a capturing dev
  provider otherwise; production refuses to boot without them or `EMAIL_UNSUBSCRIBE_SECRET`. One accessible
  template (HTML + text, `lang` set) per locale. Every email carries `List-Unsubscribe` and a signed link to
  `GET|POST /api/email/unsubscribe?token=` (`@Public`, HMAC of user + kind) that turns that kind's email off
  (`SYSTEM` / `BILLING`: explains they are required) and answers a small translated HTML page.
- **Student API** (any signed-in user, own rows only — 404 otherwise):

  | Method | Path                                 | Body / query                                                                     | Response                                                                                                                                                                     |
  | ------ | ------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET    | `/api/me/notifications`              | `?cursor=<id>&limit=1..50` (20)                                                  | `{ items: [{ id, kind, title, body, deepLink, action: { type, ref? } \| null, createdAt, readAt }], nextCursor }` newest first                                               |
  | GET    | `/api/me/notifications/unread-count` | —                                                                                | `{ count }`                                                                                                                                                                  |
  | POST   | `/api/me/notifications/:id/read`     | —                                                                                | the item                                                                                                                                                                     |
  | POST   | `/api/me/notifications/read-all`     | —                                                                                | `{ updated }`                                                                                                                                                                |
  | POST   | `/api/me/notifications/:id/fewer`    | —                                                                                | `{ kind, fewerLevel }` (max 2; 400 `NOTIFICATION_KIND_LOCKED` for SYSTEM/BILLING)                                                                                            |
  | GET    | `/api/me/notification-preferences`   | —                                                                                | `{ pushDailyCap: number\|null, pushWeeklyOptIn, reminderMinute: number\|null, kinds: [{ kind, pushEnabled, emailEnabled, fewerLevel, locked, channels: { push, email } }] }` |
  | PUT    | `/api/me/notification-preferences`   | same fields, all optional; `kinds` entries partial; `null` resets cap / reminder | same as GET; 400 `NOTIFICATION_KIND_LOCKED` / `NOTIFICATION_KIND_DUPLICATE`                                                                                                  |

  Quiet hours stay on `PATCH /api/me` (`quietHoursStart` / `quietHoursEnd`). Action types:
  `open_today`, `open_daily_quest`, `nudge_back` (`ref` = friend id), `open_league`, `open_shop`,
  `open_subscription`, `open_notification_settings`.

- **Jobs** (`apps/api/src/app/engagement/`, behind `JOBS_ENABLED`, all idempotent): daily-quest reminder every
  15 min (users active in the last 7 days with no lesson today, at `User.reminderMinute`, else 30 min after the
  typical session start — median of the first `app_opened` / `session_start` per local day over 28 days, once
  ≥ 7 days exist — else 20:00; never inside quiet hours; once per local day); weekly recap hourly, sent Monday
  09:00–12:00 user-local to users with XP or lessons last week (inbox + email, respects `emailEnabled`); the
  reactivation sweep daily at 13:40 UTC (§13). ADMIN triggers: `POST /api/admin/engagement/{daily-quest-reminders|weekly-recap|reactivation}/run`.
- **WELCOME**: sent once (inbox + email) when the auth middleware provisions a user, or on the first request of a
  user the Clerk webhook created (`lastSeenAt` still null).
- **Student app**: bell with unread count (desktop shell header / mobile Today header) → `/notifications`
  (grouped by day, quick actions, "fewer like this", offline: the last inbox cached on the device) and
  `/settings/notifications`.

## 4. Animations & feedback

`RewardOrchestrator` (see [03-shared-libraries.md](./03-shared-libraries.md) and [07-gamification.md §11](./07-gamification.md)) is the only entry point for reinforcement.

### Coin trail (the signature animation)

- 3–7 coin sprites spawn from `sourceEl` (e.g. the "Mark complete" button).
- They follow a slight curve (Bezier) toward the coin counter in the header.
- Stagger 30ms; each easing ~600ms.
- On arrival, each triggers a +1 tick on the counter (or grouped ticks if many).
- On the final coin, a small "thump" haptic and the counter scales briefly.

### Other primitives

- **XP sparkles**: small glints from sourceEl to XP bar; XP bar fills with a slight overshoot bounce.
- **Confetti burst**: tsparticles preset; 1.5s; only on level-up, badge, league promotion.
- **Counter tween**: numbers animate from old to new with `easeOutQuart`.
- **Card pop**: when a new badge or item appears, a 1.05 → 1.0 scale + opacity 0 → 1 with shadow.
- **Streak flame burst**: small fire particles when a streak day is saved.

### Sound design (short, opt-out)

- Rewards: rising arpeggio (~0.4s).
- Level up: short fanfare (~1.2s).
- Badge: distinct chime (~0.6s).
- Wrong answer: soft thud (~0.2s).
- Mystery chest: pop + rarity-flavored sting.
- All sounds are -8 LUFS-ish max to avoid jarring users.
- Master mute on by default in headphones-not-detected? Out of scope; respect device mute and user toggle.

### Haptics (mobile)

- Light: small wins.
- Medium: completions.
- Heavy: level-up, badge, league.
- Pattern (chest): rapid light-light-medium for tension.

## 5. Cohort & social

### Leagues (see [07-gamification.md §9](./07-gamification.md))

- Cohort of ~30 = mid-pack movement is constant.
- Tier system shields new users from veterans.
- Promotion rate per tier monitored: target 20–25% of users promote weekly. Adjust thresholds if outliers.

### Friends

- Add by email or share link.
- Activity feed (opt-in, friend-only).
- Mutual nudge respected.
- No public global feed (avoid moderation cost).

### Cohort challenges (later)

- "This week's React cohort" — opt-in group challenge with shared progress bar and a final reward.
- Implemented as a `LeagueLike` bonus structure on top of the regular league.

## 6. Variable-reward design

Used carefully:

- **Mystery chests** with **published drop tables** (see [07-gamification.md §10](./07-gamification.md)).
- **Surprise XP boosts**: rare, ≤ 2/week, "next 15 minutes 2x XP — go!". Calibrated so a user who happens to be in-session sees them; non-spam.

We deliberately **do not** use:

- Hidden gacha mechanics.
- Pity-only models without published thresholds.
- Loot-box monetization.

## 7. Long-arc motivation

- **Skill tree** view per track: nodes light up as completed; locked nodes show prerequisites.
- **Mastery levels per topic**: Bronze/Silver/Gold via spaced-repetition checks.
- **Capstone projects**: produce something the user can show.
- **Certificate of completion** (issued by us; not externally accredited): branded image + verifiable URL on profile.

## 8. Anti-pattern checklist (review before any feature ships)

- [ ] No notification can fire outside quiet hours unless `kind = SYSTEM`.
- [ ] No animation that cannot be skipped on `prefers-reduced-motion`.
- [ ] No SFX without user mute toggle.
- [ ] No paywall block on a free-flagged lesson.
- [ ] No streak-loss-without-recovery scenario.
- [ ] No "are you sure you want to lose your X-day streak?" dark copy on cancel — calm copy only.
- [ ] No badge whose unlock condition is hidden AND unguessable.
- [ ] No purchase flow with a pre-checked auto-renew opt-in trick.
- [ ] No mystery chest whose drop table isn't accessible from the chest UI.
- [ ] No multiplier > 30x without an explicit admin override.
- [ ] No friend-system feature that exposes private learning data without consent.
- [ ] No leaderboard that publicly ranks free users alongside whales — leagues are by tier, not paid status.

## 9. A/B testing approach

- We instrument a feature-flag service (start with a Postgres-backed `FeatureFlag` table; migrate to GrowthBook or Unleash if it becomes complex).
- Variants chosen at user signup, deterministic by `hash(userId, experimentKey)`.
- Default policy: at most one engagement experiment per user at a time on the same surface.
- Hold-out group (5–10%) carved out for long-term retention measurement.

**Implementation** (`apps/api/src/app/flags/`): `FeatureFlag.value = { enabled, rolloutPct? (default 100), holdoutPct? (default 0), variants? { key: weight }, surface? }`.
- `bucket(seed)` = first 4 bytes of `sha256(seed)` as an unsigned big-endian int, mod 10 000. Rollout/holdout use `bucket("<key>:<userId>")`; the variant uses `bucket("<key>:<userId>:variant")`.
- Order: inactive or `enabled: false` → `{ enabled: false, variant: null }`; `b < holdoutPct·100` → `{ enabled: false, variant: "holdout" }`; the remaining buckets are the rollout population (raising `rolloutPct` only adds users; the holdout never moves); enabled users get a weighted variant (keys sorted by code point, zero weights skipped) or `null` without variants. Signed-out callers are never held out, see a flag only at 100 % rollout and get the first variant.
- `GET /flags` → `{ flags: { [key]: { enabled, variant } } }` — every flag for a signed-in caller, only `surface: "public"` flags otherwise. Admin CRUD: `GET/POST /admin/feature-flags`, `PATCH/DELETE /admin/feature-flags/:key` (ADMIN, audited `feature_flag.create|update|delete`). Rows are cached in memory for 30 s; writes through the API invalidate the cache on that instance.
- Built-in flags `leagues.enabled`, `friends.enabled`, `shop.enabled` are inserted on boot when missing (never overwritten) and can be turned off but not deleted. When off, `/league/current|last-week`, `/friends/*` and `/shop`, `/shop/:id/purchase` answer `404 { code: "FEATURE_DISABLED", feature }`, and the student app hides those tabs and route-guards them.

## 10. KPI dashboards

All on Grafana. Key panels:

- D1, D7, D30 retention by signup cohort + by track.
- Median session length, sessions/week.
- Streak length distribution, freeze usage.
- Lesson completion rate, drop-off by lesson.
- League promotion rate per tier.
- Notification opt-out rate per kind.
- Reward-orchestration latency (animation start delay after API).
- Multiplier P50 / P95.

Alerts (page on-call):

- Push failure rate > 5%.
- Reward-API p99 latency > 1s.
- Stripe webhook lag > 10min.

## 11. Localization & engagement

- Tone shifts per locale: pt-BR is warmer and uses humor; en-US is concise and outcome-focused. Copy is per-locale, not translated literally.
- Festas regionais: Brazilian holidays get themed mini-events (Festa Junina, Carnaval) — small banner + a few themed items in shop.
- Currency-aware copy: "Earn coins" never expressed as "money" in user-facing strings.

## 12. Habit formation primitives

- **Cue**: push at user's typical session time + Today screen.
- **Routine**: 1 quick lesson + 1 quick exercise = ~10 min.
- **Reward**: coins + XP + cosmetic progress + streak save.
- **Investment**: customized avatar, named pet, friends, league standing.

The avatar is the long-term hook: every coin spent on it deepens user investment in the account, which is the strongest churn-reduction force we have.

## 13. Reactivation strategy

For users who lapse 7+ days:

- **Day 7**: gentle email — "Your pet [Name] misses you. Your streak freezes are gone but your progress isn't."
- **Day 14**: a "welcome back" quest — generous coin reward for returning, reduces re-onboarding friction.
- **Day 30**: a single offer — limited-time discount on annual plan if they were free, or a 14-day "win-back" content pack.
- **No daily nag email**. We respect the user's decision.

After 90 days lapsed without engagement, mark dormant; only billing emails go to dormant users (to avoid surprise charges if they had a card on file).

### Implementation

`ReactivationService` (daily) computes days lapsed from `lastSeenAt` (else `createdAt`) and jumps straight to the
highest stage reached, claiming it on `User.reactivationStage` with a conditional update before sending (reruns and
replicas never repeat a stage; a user first seen 40 days lapsed gets only the day-30 message):

- **7** → `REACTIVATION` inbox + email ("your progress is saved"). No push.
- **14** → `REACTIVATION` inbox + push announcing the welcome-back quest. The quest itself is assigned when the user
  comes back: an extra assignment of the inactive `welcome-back-<locale>` `LESSON_COUNT(1)` template (created on
  first use, 150 coins + 50 XP, admin-editable, never drawn by the daily picker) for their local today, after the
  regular daily quests, so it pays through the normal quest pipeline.
- **30** → one win-back offer (inbox + push + email) deep-linking to `/subscription?offer=winback`; skipped for
  users with an active subscription (stage still advances).
- **90** → `dormantAt` set; only `BILLING` email/push reaches them.

Any activity (the auth middleware's `lastSeenAt` refresh) resets the stage to 0 and clears `dormantAt`.

## 14. Product analytics — event catalogue

Client and server flows emit product-analytics events so every flow in the
roadmap's definition of done ("telemetry for every flow") is measurable.

### Transport

- `POST /api/analytics/events` — `@Public` (auth optional; when a bearer token
  is present the event is attributed to that user, otherwise to the
  `anonymousId` the client sends). Body:
  `{ events: [{ name, props?, ts?, anonymousId?, sessionId? }] }`, at most
  **50 events** per batch, throttled per IP/user.
- `name` must be `snake_case` (`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`, ≤ 64 chars)
  **and** appear in the catalogue below; unknown names are dropped (counted,
  not stored) so a typo can't create a new series.
- `props` is a flat JSON object, ≤ 2 KB serialized, values string / number /
  boolean / null. Never put PII in props (no emails, names, free text,
  payment details); ids are fine.
- Stored in `AnalyticsEvent`; `GET /api/admin/analytics/summary?from&to`
  (ADMIN) returns counts per event name per UTC day.
- Server-side events (rewards, billing webhooks) are written directly by the
  service that owns the flow, with the same names.

> Status: the reward / league / referral / shop flows already log the
> server-side facts below through their journals (XpEvent, CoinTransaction,
> LeagueMembership, IdempotencyRecord). The ingestion endpoint and the
> summary endpoint ship with the `AnalyticsEvent` model (roadmap
> groundwork); clients may start batching events against this contract.

### Catalogue

Common props on every event (added by the client SDK): `platform`
(`web|ios|android`), `appVersion`, `locale`, `online` (boolean).

**Lesson**

| Event                                   | When                           | Props                                                                  |
| --------------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `lesson_open`                           | Lesson player opened           | `lessonId`, `courseId`, `lessonType`, `fromOffline`                    |
| `lesson_complete`                       | Completion accepted by the API | `lessonId`, `courseId`, `lessonType`, `durationMs`, `alreadyCompleted` |
| `lesson_abandon`                        | Player left before completing  | `lessonId`, `lessonType`, `durationMs`, `progressPct`                  |
| `quiz_submit`                           | Quiz answers submitted         | `lessonId`, `scorePct`, `passed`, `attempt`                            |
| `exercise_run` / `exercise_submit`      | Code run / scored submit       | `exerciseId`, `verdict`, `runtimeMs`                                   |
| `ai_prompt_submit`                      | AI-graded answer submitted     | `aiPromptId`, `scorePct`, `passed`, `cached`                           |
| `scenario_choice` / `scenario_complete` | Branch taken / ending reached  | `scenarioId`, `depth`, `outcome`                                       |
| `paywall_view`                          | 402 paywall shown on a lesson  | `lessonId`, `courseId`                                                 |

**Reward**

| Event                                                    | When                                         | Props                                                                                        |
| -------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- | ----- | ---------------- | ------------------------- |
| `reward_granted`                                         | Server granted XP/coins (server-side)        | `source`, `xp`, `coins`, `multiplierEffective`, `multiplierCapped`, `lessonId?`, `courseId?` |
| `reward_celebration_shown`                               | RewardOrchestrator played a celebration      | `kind` (`lesson                                                                              | level_up | badge | streak_milestone | league`), `reducedMotion` |
| `level_up`                                               | Level increased                              | `newLevel`                                                                                   |
| `streak_extended` / `streak_freeze_used` / `streak_lost` | Streak day counted / freeze consumed / reset | `days`, `freezesLeft`                                                                        |
| `streak_milestone`                                       | One-time milestone paid                      | `days`, `coins`, `xp`                                                                        |
| `quest_complete`                                         | Daily quest completed                        | `questTemplateId`, `kind`, `difficulty`                                                      |
| `badge_unlocked`                                         | Badge awarded                                | `badgeSlug`                                                                                  |
| `league_viewed`                                          | League screen opened                         | `tier`, `rank`, `cohortSize`                                                                 |
| `league_result_viewed`                                   | Last-week result card seen                   | `tier`, `newTier`, `promoted`, `demoted`, `finalRank`                                        |
| `shop_view` / `item_purchase` / `item_equip`             | Shop browsed / bought / equipped             | `itemId`, `rarity`, `costCoins`, `equipOnPurchase`                                           |
| `promo_banner_view`                                      | Campaign/promo banner shown                  | `multiplierId`, `kind`, `value`                                                              |

**Download / sync (offline, docs/16)**

| Event                                                                         | When                                     | Props                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `course_download_start` / `course_download_complete` / `course_download_fail` | Offline pack download lifecycle          | `courseId`, `bytes`, `durationMs`, `error?`              |
| `offline_queue_enqueued`                                                      | A mutation queued while offline          | `kind`, `queueDepth`                                     |
| `sync_flush`                                                                  | Offline queue flushed                    | `sent`, `succeeded`, `conflicts`, `failed`, `durationMs` |
| `sync_conflict`                                                               | Server rejected/merged a queued mutation | `kind`, `resolution`                                     |

**Storage / eviction**

| Event                     | When                                  | Props                                       |
| ------------------------- | ------------------------------------- | ------------------------------------------- | ------ | ------- |
| `storage_estimate`        | Periodic quota check                  | `usageBytes`, `quotaBytes`, `persisted`     |
| `storage_persist_request` | `navigator.storage.persist()` outcome | `granted`                                   |
| `cache_evicted`           | Packs evicted (LRU / quota)           | `courseIds`, `bytesFreed`, `reason` (`quota | manual | stale`) |

**Billing**

| Event                                   | When                                   | Props                               |
| --------------------------------------- | -------------------------------------- | ----------------------------------- | ---------- | ----------- |
| `plans_view`                            | Pricing/plans screen                   | `source` (`paywall                  | settings   | marketing`) |
| `checkout_start`                        | Checkout session created               | `planId`, `period`, `method` (`card | pix        | store`)     |
| `checkout_complete` / `checkout_cancel` | Return from checkout                   | `planId`, `period`, `method`        |
| `subscription_status_changed`           | Webhook moved the status (server-side) | `from`, `to`, `source` (`stripe     | revenuecat | admin`)     |
| `payment_failed`                        | Invoice/payment failed (server-side)   | `method`, `attempt`                 |
| `restore_purchases`                     | Store restore tapped                   | `found`                             |

**Social / growth**

| Event                                             | When                                                           | Props                    |
| ------------------------------------------------- | -------------------------------------------------------------- | ------------------------ |
| `friend_request_sent` / `friend_request_accepted` | Friend request lifecycle                                       | —                        |
| `friend_invite_shared` / `friend_invite_accepted` | Invite link shared / accepted                                  | `channel?`               |
| `friend_nudge_sent`                               | Nudge sent                                                     | `pushed`                 |
| `referral_link_shared`                            | Referral link shared                                           | `channel?`               |
| `referral_claimed`                                | Referral attributed (server-side)                              | —                        |
| `referral_converted`                              | Referee finished their first lesson; reward paid (server-side) | `xp`, `coins`            |
| `certificate_claimed` / `certificate_shared`      | Certificate issued / shared                                    | `courseId`, `isCapstone` |
| `profile_view`                                    | Public profile opened                                          | `self`                   |

**Notifications**

| Event                           | When                                         | Props                                                                          |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `push_sent`                     | Push delivered to the provider (server-side) | `kind`, `devices`                                                              |
| `push_skipped`                  | Push suppressed (server-side)                | `kind`, `reason` (`quiet_hours` / `no_devices` / `cap` / `disabled` / `fewer`) |
| `push_open`                     | App opened from a push                       | `kind`                                                                         |
| `notification_settings_changed` | Quiet hours / opt-outs edited                | `kind?`, `channel?`, `enabled?`, `fields?`                                     |
| `notifications_inbox_opened`    | Inbox screen opened                          | `unread`, `count`, `fromCache`                                                 |
| `notification_opened`           | Inbox entry or its quick action tapped       | `kind`, `via` (`item` / `action`), `action?`                                   |
| `notification_fewer`            | "Fewer like this" tapped                     | `kind`, `level`                                                                |
| `app_opened` / `session_start`  | App start (student boot); session start      | `online`                                                                       |

Server-side events (`push_sent`, `push_skipped`) are written by `PushService` with `platform: "server"`. The
daily-quest reminder learns the typical session start from `app_opened` (emitted on every app start) and
`session_start`.
