/**
 * Monaco bootstrap for the student exercise editor (`cdf-code-editor` in
 * ui-ionic) — only reached through the dynamic `import()` of
 * `MONACO_LOADER` (app.config), so it lands in a lazy chunk and never in the
 * initial bundle; Storybook / tests never load it. Slim `editor.api` + the contributions a
 * learner needs; Monarch grammars for JS / TS / Python / HTML / CSS (no
 * language-service workers).
 */
import * as monaco from 'monaco-editor/editor/editor.api.js';

import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/css/register.js';

type MonacoEnv = {
  MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker };
};

const env = globalThis as unknown as MonacoEnv;
env.MonacoEnvironment ??= {
  getWorker: () =>
    new Worker(new URL('./editor.worker', import.meta.url), {
      type: 'module',
    }),
};

export { monaco };
