/**
 * Monaco bootstrap — only ever reached through the dynamic `import()` in
 * `loadMonaco()`, so everything here lands in a lazy chunk and never in the
 * admin's initial bundle.
 *
 * We pull the slim `editor.api` plus a curated set of editor contributions
 * instead of `editor.main` (which registers ~80 languages and the TS/CSS/HTML
 * language services). Languages: javascript, typescript, python (Monarch
 * grammars from monaco) and a small JSON grammar registered below.
 */
import * as monaco from 'monaco-editor/editor/editor.api.js';

import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/python/register.js';

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

let jsonRegistered = false;

/** Minimal JSON Monarch grammar (no language service / worker needed). */
function registerJson(): void {
  if (jsonRegistered) return;
  jsonRegistered = true;
  monaco.languages.register({ id: 'json', extensions: ['.json'] });
  monaco.languages.setLanguageConfiguration('json', {
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  });
  monaco.languages.setMonarchTokensProvider('json', {
    tokenizer: {
      root: [
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/[{}[\],:]/, 'delimiter'],
        [/\s+/, 'white'],
      ],
    },
  });
}

registerJson();

export { monaco };
