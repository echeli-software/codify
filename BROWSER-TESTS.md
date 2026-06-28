# Codify — Browser Test Checklist

Manual smoke/acceptance tests to walk through in the browser. The whole
roadmap (Phases 0–13) is implemented; this exercises the user-facing surfaces.

> **Note on auth:** there's no real auth provider yet — login is a dev role
> picker (click a role). External integrations (Stripe, RevenueCat, Judge0,
> FCM, the LLM grader) run as **dev stubs**, so everything works offline but
> "real" payments/native/push are simulated.

## Services & URLs

| What | URL |
|---|---|
| Student app | http://localhost:4201 |
| Admin app | http://localhost:4202 |
| API health | http://localhost:3000/api/health |
| Public landing | http://localhost:4201/welcome |
| Certificate verify | http://localhost:4201/verify |

All three should be running. If a page is blank, hard-refresh (the dev server
recompiles on first hit). Use Chrome; open DevTools for the offline tests.

**Demo content:** a course named **“Codify Demo”** was seeded with one of every
lesson type (reading, exercise, AI prompt, scenario), all free. Find it via the
Catalog. (There are also many minimal probe-generated courses — ignore the ones
with random slugs.)

---

## 0. Public marketing site (no login)

- [ ] Open `/welcome` → hero, feature cards, and a pricing section render.
- [ ] “Start free” and “Verify a certificate” buttons are visible.
- [ ] Click **Verify a certificate** → lands on `/verify` with a serial input.
- [ ] Type a bogus serial `CDFY-0000-0000` → “No certificate matches that serial.”
- [ ] (Come back here after earning a certificate in §6 to verify a real one.)

---

## 1. Student — sign in & home

Open http://localhost:4201 → you'll hit the dev login.

- [ ] Click **Student** → lands on the **Today** screen.
- [ ] Bottom tabs / nav let you reach Catalog, League, Friends, Profile, etc.
- [ ] Today shows your streak, XP/level, and daily quests (may be empty early).

---

## 2. Student — catalog & course detail

- [ ] Go to **Catalog** → a grid/list of published courses loads.
- [ ] Open **“Codify Demo”**.
- [ ] Course detail shows the title, description, and a curriculum list of 4
      lessons (reading, exercise, AI prompt, scenario), all marked free.
- [ ] A **Download for offline** button is present (used in §9).

---

## 3. Student — lesson types (the core experience)

Open **Codify Demo** and do each lesson. Each completion should fire a reward
animation (XP + coins fly up) and mark the lesson done.

### 3a. Reading
- [ ] Open **“Welcome (reading)”** → formatted text renders.
- [ ] Tap **Mark as complete** → reward animation; lesson shows Completed.

### 3b. Exercise (auto-graded code)
- [ ] Open **“Sum two numbers (exercise)”** → a code editor with starter code.
- [ ] Click **Run** (starter is empty) → visible tests show as **FAIL**.
- [ ] Replace the body so it returns `a + b`, e.g.
      `function solution(a, b) { return a + b; }`
- [ ] Click **Submit** → **PASS / 100%**, “Solved!”, reward animation.
- [ ] Immediately submit again → blocked by the rate limit (wait a few seconds).
- [ ] (Optional) Submit `while(true){}` → caught as **TIMEOUT** (sandbox kills it).

### 3c. AI prompt (rubric-graded)
- [ ] Open **“Explain error handling (AI-graded)”** → prompt + a rubric checklist.
- [ ] Submit a weak answer (e.g. “use try it”) → low score, criteria show ✗.
- [ ] Wait ~3s, then submit a strong answer such as:
      *“In JavaScript you handle errors with a try/catch block: risky code goes
      in try and the catch clause receives the Error so you can react. It
      matters because an unhandled error can crash the program or leave the user
      stuck; catching lets you recover gracefully.”*
- [ ] → **Passed**, the rubric items light up green, reward animation.
- [ ] Submit the exact same answer again → served from **cache** (a “cached” tag).

### 3d. Scenario (branching dialogue)
- [ ] Open **“The angry customer (scenario)”** → a dialogue bubble + choice buttons.
- [ ] Choose **“Apologise and investigate”** → advances to the next node.
- [ ] Choose **“Offer a refund or reship”** → **Scenario complete**, outcome
      shown (resolved), reward animation.
- [ ] Click **Play again** → restarts at the first node; pick a different branch
      (e.g. “Blame the courier”) → completes with a different outcome, **no
      second reward**.

---

## 4. Student — rewards & gamification surfaces

- [ ] During §3, confirm XP/coin counters in the header increase.
- [ ] If you cross a level threshold, a **level-up** celebration plays.
- [ ] **Avatar** page → dressing room: change skin tone / equip items you own,
      see the preview update, save.
- [ ] **Shop** page → buy an affordable item with coins (coin balance drops),
      try-on preview works; premium/limited items are flagged.
- [ ] **League** page → you're placed in a weekly league cohort with a leaderboard.
- [ ] **Friends** page → search/add a friend, send a nudge (rate-limited).

---

## 5. Student — subscription (dev checkout)

- [ ] **Subscription** page → current plan state + a list of plans with prices.
- [ ] Click **Subscribe** on a plan → redirected to the dev success page, which
      completes the stubbed checkout → status becomes **TRIALING/ACTIVE**.
- [ ] Back on Subscription, **Manage subscription** opens the (stub) portal.
- [ ] Find a course with **paid** lessons → before subscribing it shows a
      paywall; with an active plan covering its category, the lessons unlock.
- [ ] (Mobile-only bits — “Restore purchases” + store IAP — are hidden on web by
      design; they only appear inside the native shell.)

---

## 6. Student — certificate of completion 🎓

- [ ] Finish **all four** lessons in **Codify Demo** (§3).
- [ ] On the course detail page a **“Get your certificate”** card appears.
- [ ] Click it → **Certificate earned**; click **View certificate** →
      `/verify/CDFY-XXXX-XXXX` shows the branded certificate image + your name.
- [ ] Copy that URL into a fresh tab (or incognito, logged out) → it still
      verifies (the URL is **public**).
- [ ] **Profile** page → a **Certificates** section lists it, plus an **invite
      link** (referral share URL).

---

## 7. Student — profile & settings

- [ ] **Profile** → change **Display name** → it saves (toast/checkmark).
- [ ] Switch **Language** (pt-BR / en-US) → chrome strings update.
- [ ] Toggle **theme** (light/dark) if present → persists on reload.

---

## 8. Admin app (sign in as Admin at :4202)

- [ ] Open http://localhost:4202 → dev login → click **Admin** (Student is denied).
- [ ] **Courses** → list loads; open a course → edit metadata, see modules/lessons.
- [ ] Create a course → add a module → add a lesson.
- [ ] **Lesson editor**: change a lesson’s **type** to EXERCISE / AI_PROMPT /
      SCENARIO → an **“Edit …”** button appears linking to the type editor:
  - [ ] **Exercise editor** → set starter/solution + tests JSON, **Verify
        solution** → “passes”.
  - [ ] **AI prompt editor** → edit the rubric JSON, type a sample answer,
        **Grade sample** → per-criterion preview.
  - [ ] **Scenario editor** → edit the graph JSON, **Save** (invalid graphs are
        rejected with a reason).
- [ ] **Plans** → create/edit a plan, set price(s), sync to (dev) Stripe; set a
      RevenueCat entitlement id.
- [ ] **Items** → manage shop items (create, price, flag premium/limited).
- [ ] **Gamification** → review quests/badges/multipliers config.
- [ ] **Categories** → CRUD.
- [ ] On a course, toggle **Capstone** (if surfaced) — capstone courses issue a
      “Capstone Certificate”.

---

## 9. Offline (PWA) — student app

Use Chrome DevTools → Network → **Offline**.

- [ ] On Course detail, click **Download for offline** → progress completes,
      button shows Downloaded.
- [ ] Go **Offline** (DevTools) → open a **downloaded** lesson → it still renders
      from local cache.
- [ ] Complete a lesson while offline → it’s queued (“Saved offline”).
- [ ] Go back **Online** → the queued completion **syncs** automatically (reward
      reconciles).
- [ ] **Downloads** page → lists downloaded courses; you can remove one.

---

## 10. Quick sanity / regression

- [ ] API health returns `{"status":"ok"}` at `/api/health`.
- [ ] No red errors in the browser console during the happy paths above.
- [ ] Reward animations don’t double-fire on a single completion.
- [ ] Re-completing an already-finished lesson does **not** award XP again.

---

### If something is broken
- Blank page → hard refresh; check the relevant server log:
  `/tmp/codify-api.log`, `/tmp/codify-student.log`, `/tmp/codify-admin.log`.
- API 500s → check `/tmp/codify-api.log`.
- To reseed the demo course: `node tools/scripts/seed-demo-course.mjs`.
