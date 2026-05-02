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

## 4. Supported languages (initial)

- JavaScript (Node 22 LTS)
- TypeScript (tsx → Node 22)
- Python 3.12
- HTML/CSS/JS for front-end exercises (see "Browser-side" below)

Adding a language = adding a Judge0 image with the runtime + writing a test harness template.

### Browser-side exercises (HTML/CSS/JS)
- Run in the browser, not Judge0.
- Use `<iframe>` with `sandbox="allow-scripts"` (no same-origin) and CSP headers.
- Test harness: a small framework that exposes a postMessage API; tests verify DOM state, computed styles, console output.

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
{ "tests": [
  { "id": "t1", "name": "returns sum", "passed": true, "runtimeMs": 12 },
  { "id": "t2", "name": "handles empty", "passed": false, "actual": "...", "expected": "...", "runtimeMs": 8 }
] }
```

Sample JS test harness:
```js
// User code lives above this line.
const __tests = [
  { id: 't1', name: 'returns sum', fn: () => assert(sum(1,2) === 3) },
  // ...
];
const results = __tests.map(t => {
  try { const start = performance.now(); t.fn(); return { id: t.id, name: t.name, passed: true, runtimeMs: performance.now() - start }; }
  catch (e) { return { id: t.id, name: t.name, passed: false, error: String(e) }; }
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
- **Hidden-test count leak**: a determined student can brute-force hidden tests by varying code and observing the pass count returned per submission. We accept this as a tradeoff (mitigated by per-exercise rate limit + the fact that exercises grade *behavior* not memorization). If it becomes a real problem, switch the post-submit UI to "passed / failed" only (no count) until full pass.

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
