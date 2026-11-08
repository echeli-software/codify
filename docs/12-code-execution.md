# 12 — Code Execution

Self-hosted **Judge0** runs all student-submitted code. Network-isolated VPS, per-request resource limits, deterministic test harnesses.

## 1. Architecture

```
Student ──► API (NestJS)
                │
                │  enqueue submission (BullMQ)
                ▼
       ┌──────────────────────┐
       │ Submission Worker    │  reads queue
       └──────────┬───────────┘
                  │ POST /submissions (Judge0 REST)
                  ▼
       ┌──────────────────────┐
       │ Judge0 (separate VPS)│
       │  - judge0-server     │  REST API
       │  - judge0-workers    │  isolate sandboxes
       │  - judge0-redis      │  internal queue
       │  - judge0-postgres   │  internal storage
       └──────────────────────┘
```

Judge0 is self-contained. We isolate it on its own VPS with no inbound from the public internet — only the API VPS can reach it (firewall + private network).

## 2. Why a separate VPS

- **Blast radius**: code execution is the most-attacked surface. Compromise stays off the API host.
- **Resource shaping**: code workloads are bursty + CPU-heavy. Pin them to dedicated cores.
- **Easy reboot/wipe**: if compromised, we can reprovision the Judge0 host without touching the API.

## 3. Sandboxing

Judge0 uses **isolate** (the same sandbox used by competitive-programming judges). Each submission runs in:

- Fresh chroot.
- Dedicated cgroup with CPU and memory caps.
- No network (we explicitly disable; runtime tests don't need it).
- Time-budgeted (wall + CPU).
- Output size capped (truncate beyond ~64KB).
- Process count capped.

Defaults per submission:

- CPU time: 2s (configurable per `Exercise.timeLimitMs`).
- Memory: 128MB (configurable per `Exercise.memoryLimitKb`).
- Wall time: 5s.
- Stack: 64MB.
- Max processes: 30.
- Output: 64KB.
- Network: disabled.

Caps (as built): Judge0's `MAX_CPU_TIME_LIMIT=5` / `MAX_MEMORY_LIMIT=256000` / `MAX_WALL_TIME_LIMIT=5` (`infra/judge0/judge0.conf.template`) are the upper bounds of `Exercise.timeLimitMs` (100–5000) and `memoryLimitKb` (16000–256000) in the API DTOs and the admin exercise editor (`apps/api/src/app/exercises/judge0-limits.ts`). The executor always sends `wall_time_limit` 5 s and `cpu_extra_time` 0.5 s, and clamps cpu/memory to `JUDGE0_MAX_CPU_TIME_LIMIT` (s) / `JUDGE0_MAX_MEMORY_LIMIT` (KB) / `JUDGE0_MAX_WALL_TIME_LIMIT` (s) — defaults equal the template; set them only for a Judge0 host configured differently. Older rows above the caps still run, clamped.

## 4. Supported languages (initial)

- JavaScript (Node 22 LTS)
- TypeScript (tsx → Node 22)
- Python 3.12
- HTML/CSS/JS for front-end exercises (see "Browser-side" below)

Adding a language = adding a Judge0 image with the runtime + writing a test harness template.

As built: `infra/judge0/image` extends `judge0/judge0:1.13.1` with Node.js 22 and Python 3.12 as Judge0 languages **222** (JavaScript), **223** (TypeScript via Node's `--experimental-strip-types`) and **312** (Python); the API defaults to these ids and `JUDGE0_LANGUAGE_IDS` overrides them. The stock 1.13.1 image only has Node 12 / TS 3.7 / Python 3.8 (ids 63 / 74 / 71).

### Browser-side exercises (HTML/CSS/JS)

- Run in the browser, not Judge0.
- Use `<iframe>` with `sandbox="allow-scripts"` (no same-origin) and CSP headers.
- Test harness: a small framework that exposes a postMessage API; tests verify DOM state, computed styles, console output.

**As built.** `Exercise.language = "web"` (`BROWSER_EXERCISE_LANGUAGE`,
`libs/domain/src/lib/browser-exercise.ts`). The student's code is loaded as
the iframe `srcdoc` (assigned from code, so Angular doesn't sanitize the
scripts) with `sandbox="allow-scripts"` — an opaque origin with no access to
the app's cookies, storage or DOM — and a meta CSP `default-src 'none';
script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;
…` that blocks every network request. The harness (injected before the
student's code) captures `console.*` and errors and answers one
`{ type: 'codify:run-tests', nonce, tests }` message from the parent window
with the raw value of each check; the parent only accepts the reply from that
frame's window with the run's nonce and grades it (`gradeBrowserTests`, deep
equality with `expected`). A run that doesn't answer within 5 s (endless
loop, crash) fails every test.

Tests reuse the stored `{ id, name, args, expected }` shape; `args[0]` is the
check: `["text", sel]`, `["exists", sel]`, `["count", sel]`,
`["attr", sel, name]`, `["style", sel, prop]` (computed value, e.g.
`"rgb(255, 0, 0)"`), `["console", index]` (`-1` = all lines joined by `\n`),
`["eval", expr]`. They are validated on save (`INVALID_TESTS`). Hidden tests
are not used for web exercises — they would have to be shipped to the browser.

`POST /exercises/:id/browser-result` (STUDENT, reward throttle group,
`Idempotency-Key`) `{ code, results: [{ id, passed, error? }],
clientTimestamp? }` → the same `SubmissionView` as `/submit`. The server
checks that the exercise is a `web` exercise the student can access, that
every visible test is reported exactly once (`BROWSER_RESULTS_MISMATCH`) and
≤ 10 runs / minute per exercise (`SUBMIT_RATE_LIMITED`), stores a COMPLETE
Submission and, on a pass, completes the lesson through
`ProgressService.recordCompletion` (`EXERCISE_PASS`, first pass only).
`/run` and `/submit` answer `LANGUAGE_NOT_SUPPORTED` for web exercises.

**Trust model.** The verdict of a browser exercise is *client-attested*: the
server has no browser to re-run DOM / style checks, so a modified client can
report a pass. That is accepted because the reward is the same small,
non-monetary first-completion XP / coins as any lesson (paid once per lesson,
inside the daily caps and the reward rate-limit group), the submitted code is
stored with every result for review, and nothing else (certificates aside —
capstones are rubric-graded) depends on it. Server-verified grading would
need a headless-browser runner and is out of scope.

## 5. Exercise definition

`Exercise` row contains:

- `language`: string, e.g. `"javascript"`.
- `starterCode`: shown to the student initially.
- `solutionCode`: reference solution; never sent to client; used by admin "verify exercise" tool.
- `testHarness`: code that wraps user code with assertions. Language-specific template.
- `visibleTestsJson`: array of `{ id, name, args, expected, hidden: false }` shown in UI.
- `hiddenTestsJson`: same shape; hidden until pass.
- `timeLimitMs`, `memoryLimitKb`: overrides.

### Test harness contract

A test runner script is concatenated with user code at submission time. Output is structured JSON to stdout:

```json
{
  "tests": [
    { "id": "t1", "name": "returns sum", "passed": true, "runtimeMs": 12 },
    {
      "id": "t2",
      "name": "handles empty",
      "passed": false,
      "actual": "...",
      "expected": "...",
      "runtimeMs": 8
    }
  ]
}
```

Sample JS test harness:

```js
// User code lives above this line.
const __tests = [
  { id: 't1', name: 'returns sum', fn: () => assert(sum(1, 2) === 3) },
  // ...
];
const results = __tests.map((t) => {
  try {
    const start = performance.now();
    t.fn();
    return {
      id: t.id,
      name: t.name,
      passed: true,
      runtimeMs: performance.now() - start,
    };
  } catch (e) {
    return { id: t.id, name: t.name, passed: false, error: String(e) };
  }
});
console.log(JSON.stringify({ tests: results }));
```

Authoring is in admin's exercise editor (Monaco). Test fields are JSON; validation runs on save.

## 6. Submission flow

1. Student presses "Submit" in `ExerciseRunner`.
2. Client `POST /v1/exercises/:id/submissions` with `{ code }` and `Idempotency-Key`.
3. API:
   - Verifies access to the parent lesson.
   - Persists `Submission` row with verdict `PENDING` (transient — not in initial enum; we use `ERROR` if worker dies before update — handled by reconciliation).
   - Enqueues a `submission.run` job in BullMQ.
   - Returns `{ submissionId }`.
4. Client polls `GET /v1/submissions/:id` (or subscribes to a websocket; v1 is poll, 1s interval, max 10s).
5. Worker:
   - Pulls from queue. Sets `Submission.status = RUNNING`.
   - Builds the full source = user code + harness.
   - POSTs to Judge0 `/submissions?wait=true` (synchronous mode; Judge0 handles concurrency).
   - Parses Judge0 response: stdout, stderr, status, time, memory.
   - Parses harness JSON from stdout.
   - Computes `scorePct = passedCount / totalCount * 100`.
   - Updates `Submission`: `status = COMPLETE`, `verdict`, `scorePct`, `runtimeMs`, `memoryKb`, `completedAt`.
   - On pass (and first-time for this user/exercise), invokes `GamificationService.grantReward(...)` (server-side; see [01-architecture.md §6](./01-architecture.md)) and includes the canonical reward payload in the response so the client's `RewardOrchestrator` can play it.
6. Client receives final state and either celebrates or shows test failure UI.

### Stored results (as built)

- On completion the worker stores the per-test results **exactly as returned to
  the student** in `Submission.resultJson` — `{ v: 1, passed, results,
hiddenRevealed }`, hidden tests anonymised (`hidden-N`, no args / values /
  errors) unless the submission passed. The raw outcome (with hidden-test
  details and staff diagnostics) stays in `Submission.output` and never
  reaches students.
- `GET /api/submissions/:id` (student, own submissions only; 404 otherwise)
  re-shows a past submission from `resultJson` and also returns its `code`.
  Rows graded before `resultJson` existed are redacted from `output` the same
  way. `GET /api/lessons/:lessonId/exercise` returns `lastSubmissionId` (the
  caller's latest graded submission, or null) so the runner can re-show it.

### Visible vs hidden tests

- "Run" only executes visible tests (no scoring).
- "Submit" executes visible + hidden tests (scoring + reward).
- Hidden test names + outputs are revealed only on pass (so failed students don't get hints from hidden tests).

### Failure UI

- Shows which visible tests failed with diff.
- For runtime/timeout/memory errors, friendly message + link to docs (e.g. "Your function exceeded 2 seconds — consider...").

## 7. Resource & abuse limits

- Per-user per-exercise: max 1 submission per 3s.
- Per-user per-day: 200 submissions.
- Per-language global: throttle if Judge0 queue depth exceeds threshold.
- IP rate limit on the submissions endpoint (in addition to user).

As built: `POST /exercises/:id/run` and `/submit` check the backlog of the `code-submissions` queue (jobs waiting for a Judge0 worker; one global queue, not per language). At `CODE_QUEUE_MAX_BACKLOG` (default 100, matching Judge0's `MAX_QUEUE_SIZE`; `0` disables) they answer `503 { code: "CODE_QUEUE_BUSY", retryAfter }` + `Retry-After` (5–60 s, from the excess over `SUBMISSION_WORKER_CONCURRENCY`) before anything is stored. Submit also counts in the 10/min reward-event group (docs/14 §7).

## 8. Storage & retention

- `Submission` rows kept indefinitely for analytics aggregates (verdict, scorePct, timestamps).
- Code text stored as TEXT; gzip-compressed in column if size > threshold (consider; not in v1 schema).
- Detailed Judge0 stdout/stderr stored only for failed submissions (free passes for storage).
- **On user deletion** (LGPD/GDPR): `Submission.code` and `Submission.output` are nulled; `verdict + scorePct + timestamps` retained anonymized for analytics integrity.

## 9. Security considerations

- Judge0 API token never exposed to clients.
- All user input passed as code body; no shell concatenation.
- Workers strip ANSI escape codes from outputs to avoid terminal injection in admin viewing.
- Output truncation prevents log-bomb attacks.
- We never `eval` user code in our own process. Always Judge0.
- Memory leak / fork bomb: contained by isolate's process count and memory caps.
- DOS: per-VPS concurrent submission cap (e.g. 8); excess queue.
- **Hidden-test count leak**: a determined student can brute-force hidden tests by varying code and observing the pass count returned per submission. We accept this as a tradeoff (mitigated by per-exercise rate limit + the fact that exercises grade _behavior_ not memorization). If it becomes a real problem, switch the post-submit UI to "passed / failed" only (no count) until full pass.

## 10. Performance

- p50 submission turnaround target: < 1.5s.
- p95: < 4s.
- Latency dominated by isolate setup; tunable by pre-warming sandboxes (Judge0 supports a worker pool).

## 11. Admin tools

- Per-exercise dashboard: pass rate, avg attempts to pass, common failure categories.
- "Re-run reference solution" button: validates that the solution + tests still pass after a runtime upgrade.
- Bulk language re-test (e.g. after a Node minor bump).

## 12. AI-grading path (parallel feature)

For `LessonType.AI_PROMPT` lessons, the API has a separate `ai-grading` module:

1. Receives `submitPrompt` from student.
2. Runs deterministic rubric checks first (regex, presence/absence of strings, length checks).
3. If LLM-judged criteria remain, calls the platform's chosen judge model (e.g. Claude Haiku) with the prompt + rubric.
4. Returns per-criterion pass/fail + total score.
5. On pass, invokes `GamificationService.grantReward(...)`; the response payload is what the client's `RewardOrchestrator` plays.

Rate-limited per user (LLM calls cost money). Cached per identical `(promptText, exerciseVersion)`.

This module **does not** use Judge0.

## 13. Out of scope (initial)

- Multiplayer / pair-programming.
- Long-running submissions (e.g. ML training in a lesson). Cap at 5s wall.
- Persistent file system between submissions.
- Network-required tests (e.g. mock HTTP servers). Add when justified by a course need.
- Custom Docker containers per exercise (use Judge0's prebuilt language images).
- IDE-style autocomplete in the student editor (Monaco built-in is enough).
