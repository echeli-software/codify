# 17 — AI-prompt grading + scenario lessons (Phase 12)

The two differentiator content types: rubric-graded free-text answers
(`AI_PROMPT`) and branching dialogue (`SCENARIO`). Both plug into the same
lesson player + reward pipeline as readings/quizzes/exercises.

## AI-prompt grading

A prompt has a **rubric** — a list of weighted criteria. Two grading layers:

- **Deterministic** (`@codify/domain` `ai-grading.ts`): `keyword` (any/all),
  `regex` (fail-closed), `minWords` / `maxWords`. Instant, testable.
- **LLM** (`AI_GRADER` seam): `llm` criteria reach a provider — a real model
  (Claude) in prod, the deterministic `DevHeuristicGrader` locally (checks the
  response covers the criterion's `concepts`). So the full grade → reward loop
  runs offline, instantly, reproducibly — the "3s p95" target is trivially met.

`scoreRubric` does the weighted scoring + pass decision (≥ `passThreshold`).

Flow: student writes an answer → `POST /ai-prompts/:id/submit` → deterministic
criteria graded in-process, `llm` criteria via the provider, merged in rubric
order, weighted-scored. A first pass grants `AI_PROMPT_PASS` (gamification
pipeline + lesson completion + quests/badges). Guards: 1 submission / 3s,
`maxAttempts`, and an identical-response cache (no re-grade). The student view
exposes rubric **labels only** — never the keyword/regex/concept config.

Admin authors the rubric (`/lessons/:id/ai-prompt`) and can **preview** — grade
a sample answer through the exact student pipeline.

## Scenario lessons

A scenario is a directed graph of dialogue nodes; each choice either advances
(`to`) or ends the scenario (`ending` + `outcome`). `@codify/domain`
`scenarios.ts` owns the pure logic:

- `validateScenario` — author-time checks (start exists, every target
  resolves, at least one ending).
- `walkScenario` — replay a student's choice path → `valid / path / depth /
  completed / outcome`.
- `scenarioMaxDepth` — longest reachable branch (cycle-safe).

The API validates author graphs and replays student paths with the **same**
functions, so authoring and runtime never drift. The graph *is* the content —
`GET /lessons/:id/scenario` returns it; the `ScenarioRunner` walks it
client-side and `POST /scenarios/:id/complete` records each play-through. The
**first** completion grants `SCENARIO_COMPLETE`; scenarios are replayable
(later runs recorded, no double reward).

## Verification

- `phase-12b-ai-grading.mjs` (13) — mixed rubric, preview, hidden config,
  weak→FAIL w/ breakdown, strong→PASS+reward+lesson-complete, cache, rate
  limit, grade < 3s.
- `phase-12c-scenarios.mjs` (11) — invalid graph → 400, 2-deep completion +
  reward, replay without double reward, invalid path → 400.
- `phase-12-browser.mjs` (9) — AiPromptPlayground (rubric checklist lights up,
  pass) + ScenarioRunner (branch to ending, outcome) in the student player.
- `seed-soft-skills-course.mjs` — the 4-scenario "Soft Skills 101" dogfood
  course (acceptance #3).
- 69 domain unit tests; 7 builds + 13 test projects green; drift-free.

## Deferred

- **Real LLM grader** (`AI_GRADER` `llm` mode behind `ANTHROPIC_API_KEY`) — the
  seam + dev heuristic are in place; the production model call is not wired.
- **Structured rubric / visual scenario-graph builders** — admin editors use
  validated JSON for the rubric + graph (consistent with the exercise editor);
  drag-and-drop builders are a future enhancement.
