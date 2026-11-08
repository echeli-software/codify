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

**As built.** Schedule step: a time picker pre-filled 20:00 saves
`reminderMinute` (`PUT /me/notification-preferences`) and mirrors it to the
native local reminder; picking a course then launches its first free lesson
(else its first lesson). The first reward is a sheet on Today once the first
lesson is done (starter pet + name, docs/08 §10). Day-2 push: an hourly job
(minute 40 UTC, `Day2PetPushService`) sends "🐾 [pet] is waiting!" as a
`STREAK_REMINDER` the day after `onboardedAt` (user-local), inside the hour
after the learner's `reminderMinute` (default 20:00), once per user
(`IdempotencyRecord day2_pet_push:<userId>`), skipped when they already
completed a lesson that day, in quiet hours, or with STREAK_REMINDER push
off; caps / dormancy apply through NotificationService.

## 3. Notifications

### Channels

- **Push** (FCM/APNs via Capacitor; web push for PWA users).
  - As built (Phase 14): the PWA uses standard Web Push with VAPID through Angular's service worker (`SwPush`); the
    API sends with `web-push`. Browser subscriptions get the same message and rules as the native tokens (see
    Implementation below).
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

| Kind              | Channel                          | Default trigger                                                                               | Quiet hours                 |
| ----------------- | -------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| `STREAK_REMINDER` | Push                             | 2h before user-local midnight if no completion today (as built: 20:00–22:00 local, see below) | Respect quiet hours setting |
| `DAILY_QUEST`     | Push                             | 30min after user's typical session start time, if no completion                               | Respect quiet hours         |
| `FRIEND_NUDGE`    | Push (rate-limited 1/friend/day) | When a friend nudges                                                                          | Respect quiet hours         |
| `LEAGUE_RESULT`   | Push                             | Monday 09:00 user-local                                                                       | Respect quiet hours         |
| `ITEM_DROP`       | Push                             | At drop start (subject to opt-in)                                                             | Respect quiet hours         |
| `PROMO`           | Push + Email (both opt-in)       | Campaign start (subject to opt-in, default off; adults only)                                  | Respect (email anytime)     |
| `BILLING`         | Push + Email                     | On payment failure / before renewal (PIX)                                                     | Respect (email anytime)     |
| `SYSTEM`          | Push                             | Critical (account suspended, terms update)                                                    | No quiet-hours override     |

Timing implementation: `STREAK_REMINDER` uses the window 20:00–22:00 user-local instead of 22:00–24:00, because 22:00 is inside the default quiet hours (22:00–08:00, see Quiet hours), where the job skips the user, so a 22:00–24:00 reminder would never reach anyone on the defaults. An hourly job (`StreakReminderService`, `EVENING_SLOT`) reminds users with a live streak and no streak-satisfying action today whose local time is in the window and outside their own quiet hours, once per local day. `LEAGUE_RESULT` is sent by an hourly job once the member's local clock passes 09:00 on the
Monday the week ended (the rollover itself sends nothing); `PROMO` by a 15-minute job when a campaign or course promo
starts, only to users who turned PROMO push on (docs/07 §15).

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
  `data.kind` and `data.notificationId`. Tapping a native push marks that inbox entry read
  (`POST /notifications/:id/read`, fire-and-forget) and re-syncs the bell's unread count
  (`NativePushService` → `NotificationsStore.markReadFromPush`). Web push taps work the same way: the payload's
  `notification.data.onActionClick.default` (`navigateLastFocusedOrOpen`, the deep link) opens or focuses the app,
  and with the app open `SwPush.notificationClicks` routes in place and marks the entry read (`WebPushService`).
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
  `/api/email/unsubscribe?token=` (`@Public`, HMAC of user + kind). `GET` only shows a confirmation page (mail
  scanners prefetch links); `POST` — the page's button or the RFC 8058 one-click request — turns that kind's
  email off (`SYSTEM` / `BILLING`: explains they are required) and answers a small translated HTML page.
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
- **SYSTEM** (inbox + push + email; bypasses quiet hours and every cap; cannot be turned off): sent when an
  account is **suspended** (`AccountService.suspend`, on the transition only, before the device tokens are
  dropped; the staff-only reason is never included; deep link `/account/suspended`) and for a **terms update**:
  `POST /api/admin/system-notices/terms-update { version, effectiveDate?, confirm: "NOTIFY ALL USERS" }` (ADMIN,
  202, audited `system.terms_update_announced`) notifies every active account (not deleted / suspended /
  purged) in batches of 200 in the background, claiming each recipient first
  (`IdempotencyRecord system_terms_notice:<version>:<userId>`) so a rerun only reaches who is left;
  `GET /api/admin/system-notices/terms-update/:version` → `{ version, audience, notified, running }`
  (`409 ANNOUNCEMENT_RUNNING` while a run of that version is going on the instance). Deep link `/terms`.
- **WELCOME**: sent once (inbox + email) when the auth middleware provisions a user, or on the first request of a
  user the Clerk webhook created (`lastSeenAt` still null).
- **Student app**: bell with unread count (desktop shell header / mobile Today header) → `/notifications`
  (grouped by day, quick actions, "fewer like this", offline: the last inbox cached on the device) and
  `/settings/notifications`.

- **Web push (PWA, Phase 14)** — `WebPushSubscription` rows (one per browser, upserted by `endpoint`, re-owned to
  whoever registers it). `PushService` delivers to them next to the FCM tokens with the same title/body/data,
  preference, quiet-hour/deferral and cap rules (one cap slot per push); a browser-only user counts as reachable
  for the reminder jobs. Payload (Angular SW format): `{ notification: { title, body, icon, badge, tag:
notificationId, data: { …data, url, onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } } } } }`,
  TTL 24 h. A 404 / 410 from the push service deletes the subscription; other errors are logged at most once a
  minute (never the endpoint). Deleting / suspending an account drops its browser subscriptions with the tokens.
  Env `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`: unset in dev → web push off; required in
  production.

  | Method | Path                          | Auth          | Body                                                | Response                                                                                 |
  | ------ | ----------------------------- | ------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
  | GET    | `/api/push/web/config`        | public        | —                                                   | `{ publicKey }`; 404 `WEB_PUSH_DISABLED` without VAPID keys                              |
  | POST   | `/api/push/web/subscriptions` | any signed-in | `{ endpoint, keys: { p256dh, auth } }` (`toJSON()`) | `{ id }`; 400 `WEB_PUSH_ENDPOINT_NOT_ALLOWED` (not https on FCM / Mozilla / Apple / WNS) |
  | DELETE | `/api/push/web/subscriptions` | any signed-in | `{ endpoint }`                                      | `{ removed }` (own rows only)                                                            |

  Student app: the browser permission prompt is never shown on load. After a meaningful moment (a completed lesson /
  the first streak day, once the reward toast and any celebration are gone) a small non-modal card explains it and
  only its "Turn on" tap calls `SwPush.requestSubscription`; "Not now" is remembered on the device. Settings →
  Notifications has a "Browser notifications" toggle (off = DELETE + unsubscribe); iPhone / iPad outside a
  home-screen web app (iOS 16.4+) and browsers that blocked notifications get a short hint instead; the native
  shell uses FCM and shows neither. Sign-out removes the browser subscription; sign-in re-binds an existing one.

- **Promotional notifications (Phase 14)** — marketing reaches **known adults only** (date of birth 18+ years
  ago; no date → nothing, fail closed): `NotificationService` writes nothing at all (not even the inbox row) for a
  PROMO to anyone else.
  - **One-time prompt** "Get alerts about bonus events?": `GET /api/me/promo-prompt` → `{ show, promptedAt }` (show
    for an adult with ≥ 1 completed lesson never asked); `POST /api/me/promo-prompt { push, email }` stamps
    `User.promoPromptedAt` whatever the answer (409 `PROMO_PROMPT_ANSWERED` afterwards; 403
    `PROMO_PROMPT_NOT_ALLOWED` for minors / no date of birth), sets PROMO push to `push` and PROMO email to
    `email`; only the separate "also by email" tick box sets `marketingEmailOptIn = true` (audited
    `user.promo_prompt_answered`). The student app shows it as the same non-modal card after a completed lesson;
    accepting on the web is followed by the browser notifications card.
  - **Campaign email**: the 15-minute promo job also emails, at campaign start, adults with `marketingEmailOptIn`
    whose PROMO email is not off (default on, so consent is the explicit switch; the one-click unsubscribe turns
    PROMO email off). Template: bonus, course and end time in the user's zone, pt-BR / en-US, the shared layout
    with `List-Unsubscribe` + one-click POST and the reason "you chose to get bonus-event alerts by email".
    Claimed per (promotion, user) on its own key `promo_email:<multiplierId>:<userId>` (push keeps
    `promo_announce:`); a failed send releases the claim for the next run. Caps (from the EMAIL log): ≤ 2 PROMO
    emails per 7 days and ≥ 24 h apart (or the PROMO "fewer like this" window).
  - **Settings**: for adults PROMO shows push + email toggles (email on only with consent; turning it on records
    the consent); for minors / unknown age the PROMO row is hidden and `PUT` turning it on is 403
    `MARKETING_NOT_ALLOWED`.

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

**As built.** `GET /friends/activity?limit=` (≤ 50) lists the last 14 days of
lesson completions and (non-hidden) badge unlocks of friends who opted in
(`User.activityFeedOptIn`, `PATCH /me { activityFeedOptIn }`; friends who
did not opt in never appear). `GET /friends/:id/compare` returns
`{ me, friend }` stats (level, total / weekly XP, current / longest streak,
lessons, courses completed, badges) — 403 `FRIEND_REQUIRED` for non-friends.
`GET /league/history?limit=` (≤ 52) lists finished weeks
(`weekStart, tier, newTier, finalRank, cohortSize, weeklyXp, promoted,
demoted`).

### Cohort challenges (later)

- "This week's React cohort" — opt-in group challenge with shared progress bar and a final reward.
- Implemented as a `LeagueLike` bonus structure on top of the regular league.

## 6. Variable-reward design

Used carefully:

- **Mystery chests** with **published drop tables** (see [07-gamification.md §10](./07-gamification.md)).
- **Surprise XP boosts**: rare, ≤ 2/week, "next 15 minutes 2x XP — go!". Calibrated so a user who happens to be in-session sees them; non-spam.
  Implemented as a per-user `SURPRISE_BOOST` multiplier started after a completion (`boost.surprise`: 10 % chance,
  2x XP, 15 min, ≤ 2 per rolling 7 days); the app shows a countdown chip (docs/07 §15).

We deliberately **do not** use:

- Hidden gacha mechanics.
- Pity-only models without published thresholds.
- Loot-box monetization.

## 7. Long-arc motivation

- **Skill tree** view per track: nodes light up as completed; locked nodes show prerequisites.
- **Mastery levels per topic**: Bronze/Silver/Gold via spaced-repetition checks.
- **Capstone projects**: produce something the user can show.
- **Certificate of completion** (issued by us; not externally accredited): branded image + verifiable URL on profile.

**As built (skill tree).** `GET /me/mastery` → `{ topics, totals }`: one topic
per category (plus one for uncategorized courses) with lessons done / total,
`scorePct` (average best quiz / scored-exercise score) and `mastery`:
GOLD = every lesson and ≥ 90 %, SILVER = ≥ 50 % of lessons and ≥ 70 %,
BRONZE = ≥ 1 lesson (no graded attempt counts as meeting the score bar);
each course carries module nodes `COMPLETED | IN_PROGRESS | AVAILABLE |
LOCKED` (locked behind the previous unfinished module — shown, not
enforced). Student page: `/skills` (linked from Profile).

**As built (spaced-repetition checks).** Every completed lesson whose
content has a quiz block gets a `ReviewCard` (Leitner box 1–5) in box 1,
due one day after the completion. Cards are created lazily and idempotently
(`@@unique(userId, lessonId)`) whenever mastery or the review queue is read,
so completions from any path — and those made before reviews existed — get
one. Exercises, AI prompts and scenarios are not reviewed. `GET
/me/reviews?limit=` (STUDENT, 1–20, default 10) → `{ dueCount, nextDueAt,
items }`: due cards oldest first with lesson / course titles, the course's
topics, `box`, `dueAt`, `reviews`, `lapses` and a `doc` holding only the
lesson's quiz blocks in the caller's locale with the answer keys stripped
(as `GET /lessons/:id`); lessons the learner can no longer open are left
out. `POST /me/reviews/:lessonId { answers }` grades on the server with the
quiz grader: ≥ 70 % moves the card up one box (max 5) and sets `dueAt` to
+1 / 3 / 7 / 16 / 35 days by the new box; a miss drops it to box 1 (+1 day)
and counts a lapse. It returns the score, per-question feedback with the
key (the card can't be retried until due again), the new card, the
mastery of the lesson's topics and the remaining `dueCount`; 409
`review.not_due` (not due, or a concurrent review won), 404
`review.not_found`, 402 without access. Reviews pay no XP or coins and are
not quiz attempts. Mastery rule: **GOLD additionally requires every
completed lesson's review card in the topic (and course) to be in box ≥ 3**
— two passed reviews at least four days apart; BRONZE and SILVER are
unchanged. Topics and courses carry `reviews: { cards, due, mastered }` and
the view `reviewsDue`. `/skills` shows a "Review" card with the due count;
`/skills/review` runs the session one card at a time (shared lesson
renderer, check → result with the new box and topic mastery → next).

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
- **Experiment policy**: a flag with at least one positive-weight variant is an _engagement experiment_.
  - **Global hold-out**: built-in flag `experiments.global_holdout` (`{ enabled: true, holdoutPct: 5 }`); users in
    its hold-out bucket (`bucket("experiments.global_holdout:<userId>") < holdoutPct·100`) get
    `{ enabled: false, variant: "holdout" }` for **every** experiment. Disable it or set 0 % to turn it off. Plain
    feature flags and signed-out callers are never affected.
  - **One experiment per user per surface** (`surface`, default `default`): the surface's experiments are ranked
    oldest `createdAt` first (then key); the first one that takes the user — rolled out to them, or its own
    hold-out (control) — owns the surface for that user, and later ones answer `{ enabled: false, variant: null }`.
    Deterministic, and a new experiment never reshuffles users of an older one.
  - `GET /admin/feature-flags` adds `experiment` per item and `policy { globalHoldoutKey, globalHoldoutPct,
surfaces[{ surface, experiments[] }] }` (priority order); the admin Settings flags section shows it.
- Built-in flags `leagues.enabled`, `friends.enabled`, `shop.enabled` (and `experiments.global_holdout`) are inserted on boot when missing (never overwritten) and can be turned off but not deleted. When off, `/league/current|last-week`, `/friends/*` and `/shop`, `/shop/:id/purchase` answer `404 { code: "FEATURE_DISABLED", feature }`, and the student app hides those tabs and route-guards them.

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

**As built.** The admin Analytics overview (`GET /api/admin/reports/overview`,
docs/04) carries the first-party reports used before Grafana exists, among
them learners by country (`User.country` from `CF-IPCountry`: learners,
active 7 / 30 days, paid; top 10, Other, Unknown) and the monthly-BRL
"card only" checkout funnel (docs/09 §4) from the §14 events below.

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
  users with an active subscription (stage still advances). The discount itself (annual plan, once per user,
  open `WINBACK_OFFER_DAYS` after the message) is applied at checkout — see docs/09 "Win-back offer at checkout";
  the subscription page shows the offer banner and the discounted annual price.
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

| Event                                                              | When                                                  | Props                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- | ----- | ---------------- | ------------------------- |
| `reward_granted`                                                   | Server granted XP/coins (server-side)                 | `source`, `xp`, `coins`, `multiplierEffective`, `multiplierCapped`, `lessonId?`, `courseId?` |
| `reward_celebration_shown`                                         | RewardOrchestrator played a celebration               | `kind` (`lesson                                                                              | level_up | badge | streak_milestone | league`), `reducedMotion` |
| `level_up`                                                         | Level increased                                       | `newLevel`                                                                                   |
| `streak_extended` / `streak_freeze_used` / `streak_lost`           | Streak day counted / freeze consumed / reset          | `days`, `freezesLeft`                                                                        |
| `streak_milestone`                                                 | One-time milestone paid                               | `days`, `coins`, `xp`                                                                        |
| `quest_complete`                                                   | Daily quest completed                                 | `questTemplateId`, `kind`, `difficulty`                                                      |
| `badge_unlocked`                                                   | Badge awarded                                         | `badgeSlug`                                                                                  |
| `league_viewed`                                                    | League screen opened                                  | `tier`, `rank`, `cohortSize`                                                                 |
| `league_result_viewed`                                             | Last-week result card seen                            | `tier`, `newTier`, `promoted`, `demoted`, `finalRank`                                        |
| `shop_view` / `item_purchase` / `item_equip`                       | Shop browsed / bought / equipped                      | `itemId`, `rarity`, `costCoins`, `equipOnPurchase`                                           |
| `avatar_randomize` / `starter_pet_offered` / `starter_pet_claimed` | Dressing-room Random / gift sheet shown / gift opened | `itemId?`, `named?`                                                                          |
| `friend_compare_viewed` / `activity_feed_opt_in`                   | Compare sheet opened / sharing toggled                | `optIn?`                                                                                     |
| `skill_tree_viewed`                                                | Skill tree opened                                     | `topics`, `gold`, `reviewsDue`                                                               |
| `review_completed`                                                 | Spaced-repetition review graded                       | `lessonId`, `passed`, `scorePct`, `box`                                                      |
| `local_reminder_scheduled`                                         | Native backup reminder scheduled                      | `minute`                                                                                     |
| `promo_banner_view`                                                | Campaign/promo banner shown                           | `multiplierId`, `kind`, `value`                                                              |

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

| Event                                   | When                                                                                          | Props                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `plans_view`                            | Pricing/plans screen                                                                          | `source` (`paywall` / `settings` / `marketing`)                                           |
| `checkout_start`                        | Checkout started (web: session requested; native: store purchase)                             | `planId`, `period`, `method` (`card` / `pix` / `boleto` / `store`), `currency`, `visitId` |
| `checkout_method_unavailable`           | A BRL monthly checkout sheet shows "card only" (PIX / Boleto are BRL-annual only, docs/09 §4) | `visitId`, `planId`, `period`, `currency`, `method` (`pix`)                               |
| `subscription_page_exit`                | Subscription page left (route change or tab closed) without starting a checkout               | `visitId`, `lastPeriod`, `lastMethodSeen`, `cardOnlySeen`                                 |
| `checkout_complete` / `checkout_cancel` | Return from checkout                                                                          | `planId`, `period`, `method`                                                              |
| `subscription_status_changed`           | Webhook moved the status (server-side)                                                        | `from`, `to`, `source` (`stripe` / `revenuecat` / `admin`)                                |
| `payment_failed`                        | Invoice/payment failed (server-side)                                                          | `method`, `attempt`                                                                       |
| `restore_purchases`                     | Store restore tapped                                                                          | `found`                                                                                   |

`visitId` is a random id per subscription-page visit, so the monthly-PIX
funnel (docs/09 §4) can follow one visit from "card only" to its outcome.

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
| `promo_prompt_shown`            | "Get alerts about bonus events?" card shown  | —                                                                              |
| `promo_prompt_answered`         | Promo alerts prompt answered                 | `push`, `email`                                                                |
| `web_push_prompt_shown`         | "Turn on browser notifications?" card shown  | —                                                                              |
| `web_push_prompt_dismissed`     | That card's "Not now"                        | —                                                                              |
| `notifications_inbox_opened`    | Inbox screen opened                          | `unread`, `count`, `fromCache`                                                 |
| `notification_opened`           | Inbox entry or its quick action tapped       | `kind`, `via` (`item` / `action`), `action?`                                   |
| `notification_fewer`            | "Fewer like this" tapped                     | `kind`, `level`                                                                |
| `app_opened` / `session_start`  | App start (student boot); session start      | `online`                                                                       |

**Navigation / funnel (student app)**

| Event                              | When                                     | Props                                       |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `page_view`                        | Route shown                              | `route` (pattern, e.g. `/lessons/:id`)      |
| `screen_time`                      | Left a route / tab hidden                | `route`, `durationMs`                       |
| `onboarding_step_complete`         | Onboarding step finished                 | `step` (`goal` / `track` / …), step props   |
| `paywall_cta_tap`                  | Paywall call-to-action tapped            | `source`, `planId?`, `lessonId?`            |
| `catalog_search` / `global_search` | Catalog / header search answered         | `results` or `courses`, `lessons`, `length` |
| `download_offer_accepted`          | Post-enrollment download prompt          | `courseId`, `what` (`course` / `next`)      |
| `offline_session_minutes`          | Back online after ≥ 1 min offline        | `minutes`                                   |
| `lesson_progress_seen`             | Lesson opened offline (sent on sync)     | `lessonId`, `courseId`                      |
| `queue_depth_on_flush`             | Offline queue flush starts               | `queueDepth`, `manual`                      |
| `consent_updated`                  | Web consent saved (if analytics allowed) | `analytics`, `errors`                       |
| `timezone_detected`                | Device time zone applied                 | `changed`                                   |

The client maps names that predate this catalogue to it
(`TelemetryService.LEGACY_EVENT_NAMES`): `download_started|completed|failed` →
`course_download_start|complete|fail`, `download_eviction` → `cache_evicted`,
`push_opened` → `push_open`, `sync_flush_completed|failed` → `sync_flush`. Every
client event carries `locale` and `online`; on the web nothing is sent until
analytics consent is given (docs/14 §13).

Server-side events (`push_sent`, `push_skipped`) are written by `PushService` with `platform: "server"`. The
daily-quest reminder learns the typical session start from `app_opened` (emitted on every app start) and
`session_start`.
