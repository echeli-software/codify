/**
 * Code-block languages offered by the editor's language picker and
 * highlighted by the renderer. `id` is what `codeBlock.attrs.language`
 * stores; aliases map common spellings onto it. Kept free of highlight.js
 * so the editor / initial bundles never pull a grammar in.
 */
export interface CodeLanguage {
  id: string;
  label: string;
  aliases?: readonly string[];
}

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: 'plaintext', label: 'Plain text', aliases: ['text', 'txt', 'plain'] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'] },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs'] },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt'] },
  { id: 'csharp', label: 'C#', aliases: ['cs', 'c#'] },
  { id: 'c', label: 'C', aliases: ['h'] },
  { id: 'cpp', label: 'C++', aliases: ['c++', 'cc', 'hpp'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { id: 'swift', label: 'Swift' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Shell', aliases: ['sh', 'shell', 'zsh', 'console'] },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
  { id: 'xml', label: 'HTML / XML', aliases: ['html', 'svg', 'xhtml'] },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS', aliases: ['sass'] },
  { id: 'markdown', label: 'Markdown', aliases: ['md'] },
  { id: 'dockerfile', label: 'Dockerfile', aliases: ['docker'] },
];

/** Canonical language id for a stored `language` value ('plaintext' when unknown). */
export function canonicalCodeLanguage(
  value: string | null | undefined,
): string {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return 'plaintext';
  const hit = CODE_LANGUAGES.find(
    (l) => l.id === v || (l.aliases ?? []).includes(v),
  );
  return hit?.id ?? v;
}

/** Display label for a language value (falls back to the raw value). */
export function codeLanguageLabel(value: string | null | undefined): string {
  const id = canonicalCodeLanguage(value);
  return (
    CODE_LANGUAGES.find((l) => l.id === id)?.label ?? (value || 'Plain text')
  );
}

/**
 * 1-based line numbers named by `highlightLines` ("3,7-9" → {3,7,8,9});
 * ranges are capped so a typo can't allocate millions of entries.
 */
export function parseHighlightLines(
  spec: string | null | undefined,
  maxLine = 5000,
): Set<number> {
  const out = new Set<number>();
  for (const part of (spec ?? '').split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.min(maxLine, Math.max(a, b));
    for (let n = lo; n <= hi; n++) out.add(n);
  }
  return out;
}
