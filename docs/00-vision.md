# 00 — Vision & Goals

## Mission

Help people learn programming, AI usage in software development, IT-career skills, and adjacent soft skills through a deeply engaging, gamified experience. Engagement is the **core differentiator** — not content volume.

## Target audiences

### Primary: Learners
- **Career-changer**: adult, low programming experience, motivated but easily discouraged. Needs structure, daily wins, and a path to a job-relevant outcome.
- **Junior dev / student**: building portfolio depth and modern tooling fluency (incl. AI-assisted dev).
- **Working dev**: targeted upskilling — a specific framework, AI tooling, soft skill (code review, mentoring, communication).

All three need: short sessions, mobile-friendly, clear progress, social proof, replayable practice.

### Secondary: Teachers / content authors
- Subject-matter experts who can write but are not necessarily designers or developers.
- Need a block-based lesson editor that "just works", per-locale translation tabs, free-preview controls, and analytics on their courses.

### Tertiary: Operators / admins
- Manage categories, plans, pricing, promotions, items in the avatar shop, moderation, payouts (later).

## Goals (12 months)

1. **Daily-active retention competitive with Duolingo's reported D1/D7/D30** for the cohort that completes onboarding.
2. **One block-editor lesson** authored by a non-developer in **under 20 minutes**.
3. **Pay-converting trial flow** with PIX + installments — first-buy under 90 seconds from "subscribe" tap on Brazilian mobile.
4. **Single shared design system** with no Bootstrap/Ionic visual divergence in branded primitives (button, card, avatar, price tag).
5. **Server-authoritative gamification** — no client can fabricate XP, coins, or streaks.

## Non-goals (initial scope)

- Live video lessons / synchronous classes.
- User-generated public content beyond profile + cohort chat.
- Marketplace where teachers sell standalone courses (consider after platform proves out).
- Native desktop app (web PWA covers desktop).
- Certifications recognized by external bodies (issue our own; external accreditation later).
- B2B / team licensing portal (defer until consumer flywheel works).

## Success metrics

| Metric | Target (M6) | Target (M12) |
|---|---|---|
| D1 retention (post-onboarding) | 50% | 60% |
| D7 retention | 25% | 35% |
| D30 retention | 12% | 20% |
| Daily streak ≥ 7 days share of WAU | 30% | 45% |
| Free → paid conversion | 3% | 6% |
| Median session length | 8 min | 10 min |
| Sessions per active week | 4 | 5 |
| Lesson completion rate (started → finished) | 70% | 80% |
| NPS | 40 | 55 |

These are aspirational benchmarks; they exist to align scope decisions, not as commitments.

## Differentiators

1. **AI-usage as first-class subject matter** — not a sidebar. Prompt-grading, tool-use challenges, failure-mode hunts.
2. **Soft skills with rigor** — branching scenarios + AI role-play + peer review, scored on rubrics, not just "watch this video".
3. **Avatar economy** with a coin system that feels like a game, not a paywall — premium gives a multiplier, not exclusive access to advancement.
4. **Brazilian-market polish** — PIX, parcelamento, BRL-first pricing, pt-BR primary locale, low-bandwidth-aware UX.
5. **Engagement engineering as discipline** — single `RewardOrchestrator` for every reinforcement, animations + haptics + sound coupled, league system from launch.

## Anti-goals (things we explicitly will not do)

- Hidden gacha mechanics targeted at minors.
- Pay-to-skip core practice loops.
- Streak-loss-as-punishment (use freezes; never weaponize loss aversion against paying users).
- Notification spam (see [10-engagement.md §3](./10-engagement.md) for canonical caps).
- Vanity metrics (badges with no learning meaning).
- Dark patterns in cancellation flow.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Engagement loop fails to retain | M | H | Ship onboarding + leagues + streak in M1; instrument retention from day 1 |
| Code execution sandbox abuse | M | H | Judge0 isolated VPS, per-user rate limits, resource caps |
| Stripe BR limitations on PIX-recurring | H | M | Card-first for subscriptions; PIX as one-shot top-up of plans initially |
| Asset production cost (avatar items, animations) | H | M | Start with small curated set; rotate via "limited drops" to extract more value per asset |
| Capacitor IAP friction with our coin/subscription model | M | M | Consult RevenueCat docs early; design entitlements around store rules |
| Brazilian latency from non-SP hosts | H | L | Pin to DO São Paulo region from day 1 |

## Naming

"Codify" is a placeholder. Before public launch:
- Trademark search (BR + US/EU primary jurisdictions).
- Domain availability (.com, .com.br, .app).
- App Store + Play Store name availability.
- Social handle availability across IG/X/YouTube/TikTok.

This is non-trivial and should happen before the first dollar is spent on brand assets.
