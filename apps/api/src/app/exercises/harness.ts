import { randomBytes } from 'node:crypto';
import {
  deepEqual,
  ENTRY_FUNCTION_PATTERN,
  type TestCase,
  type TestResult,
} from '@codify/domain';

/**
 * Test-harness generation + output parsing shared by every executor
 * (docs/12 §5 "Test harness contract").
 *
 * Protocol
 * --------
 * - The program receives ONE JSON document on stdin:
 *     { "nonce": "<random hex>", "tests": [{ "id": "t1", "args": [..] }, ...] }
 *   Expected values never enter the sandbox — they stay on the host.
 * - A one-line prelude reads stdin BEFORE student code runs and keeps the
 *   nonce + the original stdout writer in a closure. Student code is then
 *   appended verbatim (so its line N is reported as line N + 1).
 * - After student code, the runner calls `entryFunction(...args)` per test
 *   and prints one line per test: `<nonce>{"id":..,"actual":..,"runtimeMs":..}`
 *   or `<nonce>{"id":..,"error":".."}`.
 * - The host keeps only nonce-prefixed lines, compares `actual` against the
 *   expected value itself (deepEqual), and treats everything else as student
 *   output. A duplicated result line for the same test counts as tampering.
 *
 * Why this is safe enough: even a student who manages to learn the nonce
 * (it is not a cryptographic boundary inside a process they control) can
 * only forge `actual` values — and without the hidden tests' expected values
 * that buys nothing over writing the function. The real isolation boundary
 * is the sandbox (Judge0 / isolate in prod).
 *
 * Custom harnesses (`Exercise.testHarness`, non-empty) replace the generated
 * runner: final source = student code + "\n" + testHarness. The harness reads
 * the same stdin document and prints `<nonce>{"id", "passed"?, "actual"?,
 * "error"?}` lines; a boolean `passed` from a custom harness is trusted,
 * otherwise `actual` is compared host-side.
 */

export type HarnessLanguage = 'javascript' | 'typescript' | 'python';

export interface HarnessInput {
  language: HarnessLanguage;
  code: string;
  entryFunction: string;
  tests: TestCase[];
  testHarness?: string | null;
}

export interface HarnessBundle {
  language: HarnessLanguage;
  source: string;
  stdin: string;
  nonce: string;
  /** File extension the source expects when written to disk. */
  fileExt: 'js' | 'ts' | 'py';
  /** Custom harnesses may report `passed` themselves. */
  trustPassed: boolean;
}

export function makeNonce(): string {
  return `@@codify:${randomBytes(16).toString('hex')}@@`;
}

export function buildHarness(
  input: HarnessInput,
  nonce: string = makeNonce(),
): HarnessBundle {
  if (!ENTRY_FUNCTION_PATTERN.test(input.entryFunction)) {
    throw new Error(`Invalid entry function name "${input.entryFunction}"`);
  }
  const stdin = JSON.stringify({
    nonce,
    tests: input.tests.map((t) => ({
      id: t.id,
      args: Array.isArray(t.args) ? t.args : [],
    })),
  });
  const custom = (input.testHarness ?? '').trim().length > 0;
  const fileExt =
    input.language === 'python'
      ? 'py'
      : input.language === 'typescript'
        ? 'ts'
        : 'js';

  let source: string;
  if (custom) {
    source = `${input.code}\n${input.testHarness}\n`;
  } else if (input.language === 'python') {
    source = `${pythonPrelude(input.entryFunction)}\n${input.code}\n${pythonRunner(input.entryFunction)}\n`;
  } else {
    const ts = input.language === 'typescript';
    source = `${jsPrelude(input.entryFunction, ts)}\n${input.code}\n${jsRunner(input.entryFunction)}\n`;
  }
  return {
    language: input.language,
    source,
    stdin,
    nonce,
    fileExt,
    trustPassed: custom,
  };
}

// ─── JavaScript / TypeScript ─────────────────────────────────────────────

/**
 * Single line (keeps student line numbers ≈ +1). Captures `fs`, the stdout
 * writer, JSON.stringify and process.exit before student code can
 * monkey-patch them. In TS it avoids Node typings (`eval('require')`,
 * `globalThis as any`) and async/await, so it type-checks and compiles at
 * any tsc target without @types/node. Promise-returning solutions are
 * awaited via `.then`. Exits explicitly after the last test so stray timers
 * in student code cannot turn a finished run into a timeout.
 */
function jsPrelude(entry: string, ts: boolean): string {
  const any = ts ? ': any' : '';
  const asAny = ts ? ' as any' : '';
  return (
    `const __codifyRun = (function () { ` +
    `const __g${any} = (globalThis${asAny}); const __fs${any} = eval('require')('fs'); ` +
    `const __input${any} = JSON.parse(__fs.readFileSync(0, 'utf8')); const __nonce = String(__input.nonce); const __tests${any} = __input.tests; ` +
    `const __out${any} = __g.process.stdout; const __write = __out.write.bind(__out); const __str = JSON.stringify; ` +
    `const __exit = __g.process.exit.bind(__g.process); const __now = () => Number(__g.process.hrtime.bigint()) / 1e6; let __used = false; ` +
    `const __ms = (s${any}) => Math.round((__now() - s) * 1000) / 1000; ` +
    `const __emit = (rec${any}) => { let line${any}; try { line = __str(rec); } catch (e) { line = __str({ id: rec.id, error: 'Return value is not JSON-serialisable' }); } __write(__nonce + line + '\\n'); }; ` +
    `const __ok = (t${any}, s${any}, v${any}) => __emit({ id: t.id, actual: v === undefined ? null : v, undef: v === undefined, runtimeMs: __ms(s) }); ` +
    `const __fail = (t${any}, s${any}, e${any}) => __emit({ id: t.id, error: String((e && e.message) || e), runtimeMs: __ms(s) }); ` +
    `return function (fn${any}) { if (__used) return; __used = true; let i = 0; ` +
    `const next = () => { while (i < __tests.length) { const t = __tests[i++]; const s = __now(); let v${any}; ` +
    `try { if (typeof fn !== 'function') throw new Error('Function "${entry}" is not defined'); v = fn(...t.args); } catch (e${any}) { __fail(t, s, e); continue; } ` +
    `if (v && typeof v.then === 'function') { v.then((r${any}) => { __ok(t, s, r); next(); }, (e${any}) => { __fail(t, s, e); next(); }); return; } ` +
    `__ok(t, s, v); } __exit(0); }; next(); }; })();`
  );
}

function jsRunner(entry: string): string {
  return `__codifyRun(typeof ${entry} === 'undefined' ? undefined : ${entry});`;
}

// ─── Python ──────────────────────────────────────────────────────────────

/**
 * The setup code runs via exec() in its own globals dict, so the nonce and
 * the captured stdout writer are not module globals of the student file.
 * A JSON string literal is a valid Python string literal.
 */
function pythonPrelude(entry: string): string {
  const setup = [
    'import sys, json, time, os',
    '_exit = os._exit',
    '_data = json.loads(sys.stdin.read())',
    '_nonce = str(_data["nonce"])',
    '_tests = _data["tests"]',
    '_out = sys.stdout',
    '_write = _out.write',
    '_flush = _out.flush',
    '_dumps = json.dumps',
    '_perf = time.perf_counter',
    '_state = {"used": False}',
    'def _emit(rec):',
    '    try:',
    '        line = _dumps(rec, allow_nan=False)',
    '    except Exception:',
    '        line = _dumps({"id": rec["id"], "error": "Return value is not JSON-serialisable"})',
    '    _write(_nonce + line + "\\n")',
    '    _flush()',
    'def run(fn):',
    '    if _state["used"]:',
    '        return',
    '    _state["used"] = True',
    '    for t in _tests:',
    '        s = _perf()',
    '        try:',
    '            if not callable(fn):',
    `                raise NameError('Function "${entry}" is not defined')`,
    '            actual = fn(*t["args"])',
    '            _emit({"id": t["id"], "actual": actual, "runtimeMs": round((_perf() - s) * 1000, 3)})',
    '        except BaseException as e:',
    '            _emit({"id": t["id"], "error": "%s: %s" % (type(e).__name__, e), "runtimeMs": round((_perf() - s) * 1000, 3)})',
    '    _flush()',
    '    _exit(0)',
  ].join('\n');
  return `__codify_run = (lambda __s, __g: (exec(__s, __g), __g["run"])[1])(${JSON.stringify(setup)}, {})`;
}

function pythonRunner(entry: string): string {
  return `__codify_run(globals().get(${JSON.stringify(entry)}))`;
}

// ─── Output parsing ──────────────────────────────────────────────────────

export interface ParsedHarnessOutput {
  results: TestResult[];
  /** True when every test produced exactly one result line. */
  complete: boolean;
  /** Whatever the student printed (non-protocol output), for "Run" debugging. */
  studentOutput: string;
}

interface RawRecord {
  id?: unknown;
  actual?: unknown;
  undef?: unknown;
  passed?: unknown;
  error?: unknown;
  runtimeMs?: unknown;
}

export function parseHarnessOutput(
  stdout: string,
  nonce: string,
  tests: TestCase[],
  trustPassed: boolean,
): ParsedHarnessOutput {
  const ids = new Set(tests.map((t) => t.id));
  const records = new Map<string, RawRecord>();
  const tampered = new Set<string>();
  const studentLines: string[] = [];

  for (const line of stdout.split('\n')) {
    const at = line.indexOf(nonce);
    if (at < 0) {
      if (line.length) studentLines.push(line);
      continue;
    }
    if (at > 0) studentLines.push(line.slice(0, at));
    let rec: RawRecord;
    try {
      rec = JSON.parse(line.slice(at + nonce.length)) as RawRecord;
    } catch {
      continue;
    }
    if (
      !rec ||
      typeof rec !== 'object' ||
      typeof rec.id !== 'string' ||
      !ids.has(rec.id)
    )
      continue;
    if (records.has(rec.id)) tampered.add(rec.id);
    else records.set(rec.id, rec);
  }

  const results: TestResult[] = tests.map((t) => {
    const rec = records.get(t.id);
    const runtimeMs =
      typeof rec?.runtimeMs === 'number' ? rec.runtimeMs : undefined;
    if (tampered.has(t.id)) {
      return {
        id: t.id,
        name: t.name,
        passed: false,
        error: 'More than one result was reported for this test',
      };
    }
    if (!rec)
      return {
        id: t.id,
        name: t.name,
        passed: false,
        error: 'Test did not finish',
      };
    if (rec.error !== undefined) {
      return {
        id: t.id,
        name: t.name,
        passed: false,
        error: String(rec.error).slice(0, 2000),
        runtimeMs,
      };
    }
    const actual = rec.undef === true ? undefined : rec.actual;
    const passed =
      trustPassed && typeof rec.passed === 'boolean'
        ? rec.passed
        : deepEqual(actual, t.expected);
    return passed
      ? { id: t.id, name: t.name, passed, runtimeMs }
      : {
          id: t.id,
          name: t.name,
          passed,
          actual,
          expected: t.expected,
          runtimeMs,
        };
  });

  return {
    results,
    complete: tests.every((t) => records.has(t.id) && !tampered.has(t.id)),
    studentOutput: studentLines.join('\n'),
  };
}

/** Strip ANSI escape codes (docs/12 §9) and cap length. */
export function cleanOutput(text: string, max = 4000): string {
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  return stripped.length > max
    ? `${stripped.slice(0, max)}\n… (truncated)`
    : stripped;
}
