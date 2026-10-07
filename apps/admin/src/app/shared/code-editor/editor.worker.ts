/// <reference lib="webworker" />
// Monaco's base editor worker (diffing, word-based suggestions, links).
// Bundled separately by the Angular builder via `new Worker(new URL(...))`.
import 'monaco-editor/editor/editor.worker.js';
