/**
 * Browser-side HTML/CSS/JS exercises (docs/12 §4 "Browser-side").
 *
 * The student's code runs in a sandboxed `<iframe sandbox="allow-scripts">`
 * (opaque origin: no cookies, storage or parent DOM access) under a CSP
 * that blocks every network request. A small harness injected before the
 * code captures console output and errors and answers a postMessage
 * `run-tests` request with the raw value each test reads; the parent
 * compares those values with `expected` (`gradeBrowserTests`).
 *
 * Tests reuse the stored TestCase shape — `args[0]` names the check:
 *
 *   ["text", selector]            textContent (trimmed) of the first match
 *   ["exists", selector]          whether anything matches
 *   ["count", selector]           number of matches
 *   ["attr", selector, name]      attribute value (null when missing)
 *   ["style", selector, property] computed style value, e.g. "rgb(255, 0, 0)"
 *   ["console", index]            the index-th console.log line (-1: all, joined by "\n")
 *   ["eval", expression]          value of a JS expression evaluated in the page
 *
 * Grading happens on the client; the API records the reported results
 * (`POST /exercises/:id/browser-result`). See docs/12 §4 for the trust model.
 */
import { deepEqual, type TestCase, type TestResult } from './exercises.js';

/** `Exercise.language` of a browser-run exercise. */
export const BROWSER_EXERCISE_LANGUAGE = 'web';

export const BROWSER_TEST_KINDS = [
  'text',
  'exists',
  'count',
  'attr',
  'style',
  'console',
  'eval',
] as const;
export type BrowserTestKind = (typeof BROWSER_TEST_KINDS)[number];

export function isBrowserExerciseLanguage(language: string): boolean {
  return language === BROWSER_EXERCISE_LANGUAGE;
}

/** Author-time checks for browser tests (in addition to validateTestCases). */
export function validateBrowserTests(tests: unknown): string[] {
  if (!Array.isArray(tests)) return [];
  const errors: string[] = [];
  tests.forEach((t, i) => {
    const args = (t as { args?: unknown })?.args;
    const where = `visibleTests[${i}]`;
    if (!Array.isArray(args) || typeof args[0] !== 'string') {
      errors.push(`${where}: args[0] must name a browser check`);
      return;
    }
    const kind = args[0] as BrowserTestKind;
    if (!(BROWSER_TEST_KINDS as readonly string[]).includes(kind)) {
      errors.push(
        `${where}: unknown browser check "${kind}" (use ${BROWSER_TEST_KINDS.join(', ')})`,
      );
      return;
    }
    const needs: Record<BrowserTestKind, number> = {
      text: 2,
      exists: 2,
      count: 2,
      attr: 3,
      style: 3,
      console: 2,
      eval: 2,
    };
    if (args.length < needs[kind])
      errors.push(`${where}: "${kind}" needs ${needs[kind] - 1} argument(s)`);
  });
  return errors;
}

/** What the harness reports per test: the value read, or an error. */
export interface BrowserTestProbe {
  id: string;
  actual?: unknown;
  error?: string;
}

/** Message the parent posts into the frame. */
export interface BrowserRunMessage {
  type: 'codify:run-tests';
  nonce: string;
  tests: { id: string; args: unknown[] }[];
}

/** Message the frame posts back. */
export interface BrowserResultMessage {
  type: 'codify:test-results';
  nonce: string;
  probes: BrowserTestProbe[];
  console: string[];
  errors: string[];
}

/** Compare probes with the expected values (missing probe → failed). */
export function gradeBrowserTests(
  tests: readonly TestCase[],
  probes: readonly BrowserTestProbe[],
): TestResult[] {
  const byId = new Map(probes.map((p) => [p.id, p]));
  return tests.map((t) => {
    const p = byId.get(t.id);
    if (!p) return { id: t.id, name: t.name, passed: false, error: 'Not run' };
    if (p.error !== undefined)
      return {
        id: t.id,
        name: t.name,
        passed: false,
        error: p.error,
        expected: t.expected,
      };
    return {
      id: t.id,
      name: t.name,
      passed: deepEqual(p.actual, t.expected),
      actual: p.actual,
      expected: t.expected,
    };
  });
}

/**
 * Network is blocked entirely (no exfiltration, works offline); inline
 * scripts / styles and data: images are what an exercise needs.
 */
export const BROWSER_EXERCISE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/**
 * The harness. Runs before the student's code; it must not depend on
 * anything the page defines. `__codifyRun` answers one run-tests request.
 */
const HARNESS = `(function () {
  var logs = [];
  var errors = [];
  function fmt(v) {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  ['log', 'info', 'warn', 'error'].forEach(function (k) {
    var orig = console[k];
    console[k] = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
      if (logs.length < 500) logs.push(parts.join(' '));
      try { orig.apply(console, arguments); } catch (e) {}
    };
  });
  window.addEventListener('error', function (e) {
    if (errors.length < 50) errors.push(String((e && e.message) || e));
  });
  function plain(v) {
    if (v === undefined) return null;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); }
  }
  function probe(args) {
    var kind = args[0];
    var el;
    switch (kind) {
      case 'text':
        el = document.querySelector(args[1]);
        return el ? (el.textContent || '').trim() : null;
      case 'exists':
        return !!document.querySelector(args[1]);
      case 'count':
        return document.querySelectorAll(args[1]).length;
      case 'attr':
        el = document.querySelector(args[1]);
        return el ? el.getAttribute(args[2]) : null;
      case 'style':
        el = document.querySelector(args[1]);
        return el ? getComputedStyle(el).getPropertyValue(args[2]).trim() : null;
      case 'console':
        return args[1] === -1 ? logs.join('\\n') : (logs[args[1]] === undefined ? null : logs[args[1]]);
      case 'eval':
        return plain((0, eval)(String(args[1])));
      default:
        throw new Error('Unknown check: ' + kind);
    }
  }
  function run(msg, source) {
    var probes = (msg.tests || []).map(function (t) {
      try { return { id: t.id, actual: plain(probe(t.args || [])) }; }
      catch (e) { return { id: t.id, error: String((e && e.message) || e) }; }
    });
    source.postMessage({ type: 'codify:test-results', nonce: msg.nonce, probes: probes, console: logs.slice(0, 200), errors: errors.slice() }, '*');
  }
  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || msg.type !== 'codify:run-tests' || ev.source !== window.parent) return;
    if (document.readyState === 'complete') run(msg, ev.source);
    else window.addEventListener('load', function () { run(msg, ev.source); });
  });
})();`;

/**
 * The iframe `srcdoc`: CSP + harness first, then the student's document.
 * A full document (`<head>`) gets the preamble injected right after its
 * `<head>` tag; a fragment is wrapped in a minimal document.
 */
export function buildBrowserSrcdoc(code: string): string {
  const preamble =
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BROWSER_EXERCISE_CSP}">` +
    // A literal "</script>" in the harness would end the tag early.
    `<script>${HARNESS.replace(/<\/script/gi, '<\\/script')}</script>`;
  const head = /<head(\s[^>]*)?>/i.exec(code);
  if (head) {
    const at = head.index + head[0].length;
    return code.slice(0, at) + preamble + code.slice(at);
  }
  return `<!doctype html><html><head>${preamble}</head><body>${code}</body></html>`;
}
