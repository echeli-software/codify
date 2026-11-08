/**
 * Lazily loaded syntax highlighter (docs/06 §3 code block). Imported only
 * through `import('./highlighter.js')` from the code-block component, so
 * highlight.js and its grammars become a separate chunk that loads the
 * first time a lesson actually shows code.
 *
 * Output is highlight.js's escaped HTML (`<span class="hljs-…">` + text
 * entities only), split into lines with open spans closed / reopened at
 * each newline so every line can be wrapped (numbers, emphasis).
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { CODE_LANGUAGES, canonicalCodeLanguage } from './code-languages.js';

const GRAMMARS = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  plaintext,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  hljs.registerLanguage(name, grammar);
}
for (const lang of CODE_LANGUAGES) {
  if (lang.aliases?.length && hljs.getLanguage(lang.id))
    hljs.registerAliases([...lang.aliases], { languageName: lang.id });
}

/** Largest source highlighted (bigger blocks render as plain text). */
const MAX_CHARS = 50_000;

/**
 * Split highlight.js HTML into per-line HTML, closing and reopening the
 * spans that are open at each newline.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      open.push(m[1]);
      line += m[1];
    } else if (m[2]) {
      open.pop();
      line += m[2];
    } else if (m[3]) {
      line += '</span>'.repeat(open.length);
      lines.push(line);
      line = open.join('');
    } else {
      line += m[4];
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Highlighted HTML per line for `code` in `language`, or null when the
 * language is unknown (callers render plain text).
 */
export function highlightLines(
  code: string,
  language: string | null | undefined,
): string[] | null {
  const id = canonicalCodeLanguage(language);
  if (id === 'plaintext' || code.length > MAX_CHARS) return null;
  if (!hljs.getLanguage(id)) return null;
  const { value } = hljs.highlight(code, {
    language: id,
    ignoreIllegals: true,
  });
  return splitHighlightedLines(value);
}
