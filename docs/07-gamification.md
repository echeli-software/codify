# 07 — Gamification

The single most important system in the product. Server is authoritative for all earning; client orchestrates the experience.

## 1. Core systems at a glance

| System         | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| XP             | Long-arc progress. Drives level. Visible everywhere.                    |
| Levels         | Unlock items, gate cosmetics, signal mastery.                           |
| Coins          | Spendable currency for cosmetics.                                       |
| Multipliers    | Configurable boosters (premium, course/lesson promo, streak, campaign). |
| Streaks        | Daily-loop driver. Freezes prevent loss.                                |
| Daily quests   | Variety + sub-daily goals.                                              |
| Badges         | Recognition for milestones.                                             |
| Leagues        | Weekly cohort competition.                                              |
| Mystery chests | Variable-reward dopamine, with **published drop tables**.               |

## 2. Earning rules (defaults; configurable in admin)

| Action                         | XP     | Coins  | Notes                                 |
| ------------------------------ | ------ | ------ | ------------------------------------- |
| Reading lesson complete        | 10     | 5      | Once per `(user, lesson)`; idempotent |
| Quiz lesson complete           | 15     | 8      | Plus per-question bonus               |
| Quiz: perfect score            | +10    | +5     | Bonus on top                          |
| Exercise pass (first time)     | 25     | 12     | Subsequent attempts: 0 (no farming)   |
| Exercise pass (retake)         | 5      | 2      | Cap once per day                      |
| AI prompt pass                 | 20     | 10     | Same first-time vs retake rule        |
| Scenario complete (per branch) | 10     | 5      | Cap 3 branches per scenario per day   |
| Daily quest complete           | 0      | 20     | Quest defines XP separately           |
| Streak day milestone (7)       | 0      | 50     | One-time per milestone hit            |
| Streak day milestone (14)      | 0      | 100    |                                       |
| Streak day milestone (30)      | 0      | 200    |                                       |
| Streak day milestone (100)     | 100    | 500    |                                       |
| Streak day milestone (365)     | 500    | 2000   |                                       |
| Badge unlock                   | varies | varies | Per badge config                      |
| League promotion               | 50     | 100    | At week roll                          |
| League rank #1 in cohort       | +25    | +50    | At week roll, on top of promotion     |

All values are admin-editable via `Settings → Gamification defaults`. Changes are versioned in `AuditLog`.

## 3. The multiplier system (the configurable engine)

This is the user's stated requirement: premium has a configurable rate, specific courses/lessons can run promotions, streak days can also boost.

### Multiplier types (the `MultiplierKind` enum)

| Kind               | Bind to                      | Use case                                                                |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------- |
| `PREMIUM_DEFAULT`  | None (global)                | Paid-user default. Default value 2.00; admin can set to 1.5 or 3.0 etc. |
| `COURSE_PROMO`     | `Course`                     | "Boost engagement on the new React course: 4x coins for two weeks"      |
| `LESSON_PROMO`     | `Lesson`                     | "This capstone lesson awards 5x XP"                                     |
| `STREAK_TIER`      | `streakDaysMin` (e.g. 7, 30) | "Once you hit a 30-day streak, every reward is 1.5x"                    |
| `LEAGUE_PROMOTION` | None                         | Single-event boost on rank-up                                           |
| `CAMPAIGN`         | None (time-bounded)          | "Double-XP weekend" platform-wide                                       |

Each multiplier has:

- `target`: `XP`, `COINS`, or `BOTH`.
- `value`: decimal (typical 1.5 – 5.0).
- `startsAt` / `endsAt`: optional time window.
- `description`: shown in the user-facing "why am I getting Xx?" breakdown.

### Resolver rules

For any reward event, `libs/domain/multipliers.resolveMultiplier({ user, lesson, course, streak, now })` returns the effective multipliers separately for XP and Coins.

**Stacking rule**: multiplicative across categories, but only one of each category applies. Order:

1. `PREMIUM_DEFAULT` (1.0 if free user; configured value if paid)
2. `STREAK_TIER` (highest tier the user qualifies for)
3. `COURSE_PROMO` ⊕ `LESSON_PROMO` (the more specific wins; never both)
4. `CAMPAIGN` (if any active)
5. `LEAGUE_PROMOTION` (only on the league-promotion event itself)

Example for a 30-day-streak premium user doing a 4x-promo lesson during a 2x campaign:

```
Effective XP/COINS multiplier
  = 2.0 (premium)
  × 1.5 (streak tier)
  × 4.0 (lesson promo)
  × 2.0 (campaign)
  = 24.0x
```

We **cap the effective multiplier at 30x** to prevent surprise mega-payouts in stacking edge cases. The cap is configurable; we log a warning whenever the cap clips a calculation so admins notice if their stack is accidentally generous.

### Breakdown for UI

The resolver returns:

```ts
{
  xp:    { effective: 24.0, components: [{kind:'PREMIUM_DEFAULT',value:2}, ...] },
  coins: { effective: 24.0, components: [...] }
}
```

The student app shows a tap-to-expand breakdown on every reward toast: "+240 XP (×24 = base 10 × premium 2 × streak 1.5 × lesson promo 4 × campaign 2)". This **transparency builds trust** and makes the user actively want streaks/premium.

### Promotional UX

- Course/lesson promos display a corner badge ("4x coins now!") in catalog and player.
- Campaigns get a top-banner in the student app ("Double-XP weekend — ends Sun 23:59").
- Admins can schedule promos in the future; the resolver respects `startsAt`.

## 4. XP & levels

### XP curve

Level `L` requires cumulative `xpForLevel(L)` total XP. We use a quadratic-ish curve that softens at high levels:

```ts
function xpForLevel(L: number): number {
  if (L <= 1) return 0;
  // Triangle-number-style growth with a 100 multiplier, plus a small linear component
  return Math.round(50 * (L - 1) * L + 25 * (L - 1));
}
```

Sample:
| Level | Cumulative XP | Delta from prev |
|---|---|---|
| 1 | 0 | – |
| 2 | 125 | 125 |
| 5 | 1100 | ~325 |
| 10 | 4725 | ~875 |
| 25 | 30600 | ~2575 |
| 50 | 123725 | ~5125 |

Level 50 should take a determined daily learner ~6 months at default rates. Above L50 we still award levels (no cap) but the visual treatment changes (prestige rings, etc.) to keep the journey feeling alive.

`libs/ui-core/level` exports `xpForLevel`, `levelFromXp`, `xpToNextLevel`, `levelProgressPct`.

### Visual milestones

- Every 5 levels: a new tier (Bronze, Silver, Gold, Platinum, Diamond, Mythic, then prestige).
- Level-up shows a full-screen overlay with the tier color and a rotating set of motivational copy in the user's locale.

## 5. Coins

- Earned per the table above, multiplied per the resolver.
- Spent in the shop, on mystery chests, on daily-quest rerolls (later).
- Server-authoritative ledger (`CoinTransaction`); client mirrors with optimistic UI but reconciles to server response.
- Anti-abuse: daily caps per source (e.g. max 200 coins/day from `LESSON_COMPLETE`); excess goes to a "weekly bonus pool" capped at 500.

## 6. Streaks

- A streak day is satisfied by **any of**: a lesson completion, an exercise pass, or a daily quest completion in the user's local day.
- Tracked in `Streak` table (one row per user); `lastActivityDate` stored as user-local date.
- **Freezes** are auto-applied on a missed day, capped at 2 banked. Earned: 1 per 7-day streak hit, 1 per weekly league win.
- Freezes are **earned, never sold**. (We refuse to monetize loss aversion.)
- Notification timing: scheduled per user reminder slot; if no completion by 2h before local midnight and the user hasn't disabled it, send "Don't break your N-day streak!" push.

### Streak tier multipliers (default)

These are _ongoing_ multipliers (apply to every reward while qualifying), distinct from the one-shot milestone payouts in §2.

| Streak ≥ | Multiplier (XP+Coins) |
| -------- | --------------------- |
| 7        | 1.10x                 |
| 14       | 1.25x                 |
| 30       | 1.50x                 |
| 100      | 1.75x                 |
| 365      | 2.00x                 |

The highest qualifying tier applies; not stacked among themselves. Seeded as `Multiplier(kind=STREAK_TIER, streakDaysMin=N, value=...)` rows so admins can edit values or thresholds without code changes.

## 7. Badges

`Badge.rule` is a small JSON DSL evaluated server-side after every relevant event. The evaluator runs as a queued job (BullMQ) so reward latency is unaffected.

### Rule DSL examples

```json
// "First Steps" — first lesson complete
{ "all": [{ "event": "lesson_complete", "count": { "gte": 1 } }] }

// "Week Warrior" — 7-day streak
{ "all": [{ "metric": "streak.current_days", "gte": 7 }] }

// "Polyglot" — completed lessons in 3+ categories
{ "all": [{ "metric": "categories.completed", "gte": 3 }] }

// "Code Crusher" — 50 exercise passes
{ "all": [{ "event": "exercise_pass", "count": { "gte": 50 } }] }

// "Prompt Pro" — 10 ai_prompt passes with score ≥ 80
{
  "all": [
    { "event": "ai_prompt_pass", "where": { "scorePct": { "gte": 80 } }, "count": { "gte": 10 } }
  ]
}

// "Comeback" — completed a lesson after losing a streak (hidden badge)
{ "all": [{ "event": "lesson_complete", "where": { "afterStreakLost": true } }] }
```

Predicates: `gte`, `lte`, `gt`, `lt`, `eq`. Combinators: `all`, `any`. `event` filters on event types. `metric` reads precomputed user metrics.

A badge config also includes:

- `xpReward`, `coinReward` granted on unlock.
- `isHidden` — hidden until earned (drives surprise / discovery).
- Translatable name + description.
- Icon asset.

## 8. Daily quests

- Each user is assigned **3 quests per day** at midnight local. Drawn from active `QuestTemplate`s using a weighted picker that ensures mix (one easy, one medium, one harder).
- Quests are displayed on Today and via push notification.
- Reroll (deferred to Phase 7+ follow-up): paid users will be able to reroll one quest per day. Schema fields (`QuestAssignment.rerolledAt`, `originalTemplateId`) added when shipped.
- Completed quest: standalone XP/coin reward; also counts toward badges/league XP and satisfies the day's streak (see §6).

### Quest kinds (initial)

- `LESSON_COUNT`: complete N lessons.
- `CATEGORY_LESSON_COUNT`: complete N lessons in a category (drives diversification).
- `XP_AMOUNT`: earn N XP today.
- `STREAK_MAINTAIN`: just keep the streak.
- `EXERCISE_PASS`: pass N exercises.

## 9. Leagues

The single most powerful retention lever after streak.

- Weekly cohorts of ~30 users, sharded by `(tier, weekStart, cohortKey)`.
- Tiers: Bronze → Silver → Gold → Platinum → Diamond. New users start at Bronze.
- Sharding: assigned at week-start by hashing `userId + weekStart`, ensuring stable assignment without database hot rows.
- Weekly XP from all sources accumulates into `LeagueMembership.weeklyXp`.
- At week end (rollover job runs Monday 00:05 UTC; `weekStart` always refers to UTC Monday 00:00):
  - Top 7 promote to next tier.
  - Bottom 5 demote to previous tier (Bronze never demotes).
  - Middle holds.
  - Promotion: 50 XP + 100 coins + a freeze.
  - Top of cohort: +25 XP + +50 coins + a special weekly badge (rotates monthly).
- League membership becomes inactive 4 weeks after the week ends (history preserved).
- **Small cohorts** (early weeks, quiet tiers) scale the zones instead of
  applying 7/5 literally — which would promote everyone in a 6-person
  cohort: promote `round(n × 7/30)` (min 1, max 7, never all n), demote
  `round(n × 5/30)` (min 1, max 5) only when `n ≥ 5`, zones never overlap.
  A full 30-person cohort gets exactly 7 / 5. Members with 0 weekly XP never
  promote or take the #1 bonus. (`promoteZoneSize` / `demoteZoneSize` in
  `@codify/domain`.)
- Rewards (promotion, rank-1) and the freeze cap are admin-editable
  (`GamificationConfig`: `league.promotionReward`, `league.rank1Reward`,
  `streak.freezeCap`). The rank-1 badge is `league-champion-YYYY-MM`, created
  hidden on first use each month. `GET /api/league/last-week` returns the
  caller's result; each member gets a `LEAGUE_RESULT` push after rollover.
- Cohort placement takes a per-(tier, week) advisory lock so concurrent joins
  can't overfill a cohort past 30.

### Honest competition

- Cohorts of 30 (not 100) keep mid-pack movement frequent.
- Tier system prevents new users from ever facing veterans.
- Promotion is achievable for a casual learner who hits their daily quests.

## 10. Mystery chests (deferred — post-launch backlog)

Concept locked but **not in v1**. The shipping cost (drop-table tooling, `Chest`/`ChestType`/`ChestOpen`/`PityCounter` data model, audit pipeline, drop-rate dashboards, RNG verification) is meaningful and chests aren't required to validate the engagement loop. Re-evaluate after Phase 9 once league + cosmetics are running. When shipped:

- Earned primarily, not bought; coin-purchase optional and expensive.
- **Drop tables published in-app** (no hidden gacha).
- Three rarities (standard / rare / epic).
- Server-rolled with CSPRNG; each open writes `(userId, chestType, rolledItemId, seed, dropTableVersion)` to an audit table; weekly rollup compares observed vs published rates.
- Pity counter per user per chest type guarantees an uncommon+ after N opens.

Until then: surprise rewards come from the existing systems (streak milestones, league wins, daily quests, campaigns).

## 11. Reward orchestration (client)

`libs/gamification-engine/RewardOrchestrator.grant(payload)` is the only entry point. It schedules:

```
HAPTIC (immediate)
  ├─ light  for small wins
  ├─ medium for lesson/quiz completions
  └─ heavy  for level-up / badge / league

VISUAL (timeline)
  T+0     primary cue (check pulse, button morph)
  T+50ms  coin trail starts (sourceEl → coin counter)
  T+200ms XP sparkles (sourceEl → XP bar)
  T+400ms counter increments tween starts (canonical totals from API)
  T+600ms reward toast slides in
  T+900ms toast slides out
  if levelUp:
    T+1100ms level-up overlay
  if badge:
    T+1100ms (or after level-up) badge overlay
  if league promo:
    banner persists into next route

SOUND (debounced)
  one short SFX per orchestration call, even if multiple events
  reward kind picks the SFX

QUEUE
  Multiple rewards within 800ms collapse into one celebration
  with combined visuals and a single SFX/haptic cluster
```

### Reduced-motion / reduced-sound

- `prefers-reduced-motion` → skip all GSAP timelines; counters increment by simple ease in 200ms; no overlays (replace with a simple toast).
- User-toggled "reduced sound" → SFX off; haptic still on.
- Both honored everywhere via a `MotionAndSoundService`.

### Anti-abuse on the client

- Optimistic UI is _display-only_: balances rendered are always the canonical server values from the latest reward response. We never let the client invent a reward.

## 12. Anti-abuse on the server

- All reward writes use Postgres transactions.
- Idempotency: every mutating reward call requires `Idempotency-Key` (UUID v4). Stored in Redis (24h) + `IdempotencyRecord` (audit).
- Per-source daily caps configurable in `GamificationConfig` rows; admin-editable.
- Rate limit: max 10 reward events per user per minute (well above legitimate use).
- Cooldown on retake-XP for exercises (1 per day per exercise).
- Submission scoring is server-side; client cannot claim a score.
- Coin grants > 1000 require admin role (audit-logged).
- Nightly drift check: latest `CoinTransaction.balanceAfter` per user vs `SUM(delta)`; alert on mismatch.

## 13. Telemetry & tuning

Every reward event logs:

- `userId`, `source`, `xpAwarded`, `coinsAwarded`, `multiplierEffective`, `multiplierBreakdown`, `lessonId?`, `courseId?`.

Dashboards:

- Distribution of effective multipliers (catch runaway stacking).
- Coin earn vs spend ratio (calibrate shop pricing).
- Time-to-level-up by cohort.
- Streak length distribution; freeze usage.
- Badge unlock distribution (avoid "30% of users have all badges" or "no one has them").
- League promotion rate per tier.

Weekly tuning rituals:

- If shop spend > 0.6× shop earn for a week → ship more premium-ish items or raise prices.
- If P50 streak < 3 → daily quest design too hard or notifications wrong.
- If multiplier P95 > 12x → check for accidental campaign × promo overlap.

## 14. Anti-patterns

Two gamification-specific commitments: paid premium gives multipliers (never levels or unlocks of advancement), and we monetize _no_ form of streak-loss. The full review checklist for any feature touching engagement lives in [10-engagement.md §8](./10-engagement.md).

## 15. Implementation notes (economy)

How the rules above are implemented; every number is a `GamificationConfig`
key (admin: Gamification → Defaults; League zone sizes on the Leagues page).

- **Lesson base reward** (`earning.byLessonType`, default = the §2 table;
  CAPSTONE 25/12). `Lesson.baseXp` / `baseCoins` keep their column defaults
  (10 / 5) — so the rule, per field, is: a value an author changed away
  from 10 XP / 5 coins wins; a value still at the column default uses the
  per-type default (`lessonBaseReward` in `@codify/domain`). An author who
  wants exactly 10 XP on a non-reading lesson uses 9 or 11.
- **Quiz bonuses**: a passing quiz pays its base as `LESSON_COMPLETE`; a
  100 % score adds `earning.quizPerfectBonus` (10 / 5) as its own
  `QUIZ_PERFECT` ledger rows; `earning.quizPerQuestionBonus` (default 0 =
  off; the docs give no amount) pays per correct answer. Both are
  multiplied like the completion and appear as breakdown lines.
- **Retakes**: an exercise / AI-prompt pass of an already-completed lesson
  pays `earning.retake` (5 / 2, source `RETAKE`) once per lesson per
  user-local day. A scenario run that reaches an ending the user never
  reached before pays `earning.scenarioBranch` (10 / 5, source
  `SCENARIO_BRANCH`), at most `dailyCap` (3) per scenario per local day —
  the first completion counts when it was today. Both count for the
  streak, XP / exercise / streak quests and badges, not lesson-count
  quests. Responses carry the reward with `alreadyCompleted: true,
retake: true`.
- **Daily coin caps** (`coins.dailyCaps`, default `{ LESSON_COMPLETE: 200 }`,
  user-local day): the part of a grant over the cap goes to the user's
  `CoinBonusPool` for the UTC week (cap `coins.weeklyPoolCap`, 500); the
  rest is dropped. Rewards report `coinCap { requested, pooled, dropped }`
  and a `DAILY_CAP` breakdown line. An hourly job pays closed weeks' pools
  as `WEEKLY_BONUS`. Admin grants, promo codes, league rewards and pool
  payouts are never capped.
- **Streaks**: `Streak.lastActivityDate` is the last _covered_ local day.
  Missed days use banked freezes one each; when they run out the streak is
  lost (`currentDays = 0`, the freezes are used up). The summary, reminders
  and the reward pipeline all read the _effective_ streak
  (`settleStreak` / `effectiveStreak`); an hourly job writes it back
  (and records server-side `streak_freeze_used` / `streak_lost`). Streak
  reminders only go to live streaks.
- **Multipliers**: per-user `SURPRISE_BOOST` rows (category 5 of the
  resolver) — after a completion, `boost.surprise.chancePct` (10 %) starts
  a 15-minute 2x XP boost, at most 2 per rolling 7 days; never listed by
  `/multipliers*`. The breakdown lists each factor with `appliesTo`
  (`xp` / `coins` / `both`).
- **Streak cosmetics**: reaching 30 / 100 / 365 days grants
  `streak-30-flame-frame`, `streak-100-blaze-hat`, `streak-365-phoenix-pet`
  (category `streak-rewards`, inactive = never sold) as `UserItem` source
  `PROMO`; the milestone in the reward carries the item.
- **Badges** `where` filters: `scorePct` (numeric predicate; ai_prompt_pass,
  quiz_pass, exercise_pass) and `afterStreakLost: true` (any lesson event;
  counted at most once). Unknown filters / misuse are listed as validation
  errors.
- **Leagues**: zone sizes `league.zones` `{ cohortSize, promote, demote,
minCohortForDemotion }` (default 30 / 7 / 5 / 5). LEAGUE_RESULT is sent by
  an hourly job once the member's local clock passes 09:00 on the Monday the
  week ended (docs/10 §3), not at rollover.
- **Promo codes** (docs/08 §12): `PromoCode` rows (stored upper-case),
  redeemed once per user, inside `startsAt`/`endsAt` and
  `maxRedemptions`, as a `PROMO_CODE` coin row. API:

  | Method | Path                         | Auth           | Body                                                                                       | Response                                                                                                                                                                        |
  | ------ | ---------------------------- | -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET    | `/api/admin/promo-codes`     | ADMIN          | —                                                                                          | `PromoCode[]` (+ `redeemableNow`)                                                                                                                                               |
  | POST   | `/api/admin/promo-codes`     | ADMIN, audited | `{ code, coins (1–10 000), maxRedemptions?, startsAt?, endsAt?, isActive?, description? }` | the code; 409 `PROMO_CODE_TAKEN`                                                                                                                                                |
  | PATCH  | `/api/admin/promo-codes/:id` | ADMIN, audited | same minus `code`                                                                          | the code                                                                                                                                                                        |
  | DELETE | `/api/admin/promo-codes/:id` | ADMIN, audited | —                                                                                          | `{ deleted }` (a redeemed code is deactivated)                                                                                                                                  |
  | POST   | `/api/me/promo-codes/redeem` | STUDENT        | `{ code }`                                                                                 | `{ code, coins, totals }`; 404 `PROMO_CODE_NOT_FOUND`, 400 `_NOT_STARTED`, 410 `_EXPIRED`, 409 `_ALREADY_REDEEMED` / `_EXHAUSTED`, 429 `_RATE_LIMITED` (10 failed tries / hour) |

- **Jobs** (behind `JOBS_ENABLED`, idempotent; ADMIN trigger
  `POST /api/admin/gamification/jobs/{streak-settle|weekly-bonus|promo-announce|league-results}/run`):
  streak settlement hourly :10, bonus payout hourly :20, PROMO announcement
  every 15 min (campaigns / course promos that started in the last 24 h →
  users who turned PROMO push on), LEAGUE_RESULT hourly :03.
- **Summary** `GET /api/gamification/summary` also returns
  `streak.activeToday`, `surpriseBoost` and `weeklyBonusPool`.
- **Client** (§11): the first reward plays immediately; only follow-ups
  inside 800 ms collapse. Streak milestone and league promotion get a
  celebration card (league: also a banner kept into the next route,
  triggered once from `/league/last-week`), quests and bonus lines go on the
  toast, every 3rd lesson in a session gets a micro-celebration, XP
  sparkles fly to the XP counter and a flame burst plays on the streak
  counter when a day is saved (all skipped under reduced motion).
- **Seed**: migration `20261108120000_gamification_defaults` (data only,
  idempotent) inserts PREMIUM_DEFAULT 2.0, the §6 streak tiers, 9 starter
  quest templates (20 coins), the 6 §7 starter badges and the streak
  cosmetics, with en-US translations.
