/**
 * Translation structure lock (docs/11 §3 "the doc structure is locked"):
 * a translated lesson body may change text — inline content, alt text,
 * captions, titles, quiz questions / option text / explanations, code —
 * but never the block skeleton or the attributes that carry behaviour
 * (quiz ids, kinds, option ids and answer keys; ref ids; image sources;
 * embed URLs; heading levels; callout kinds; code languages; table shape).
 * Otherwise grading, progress and offline answer hashes would diverge
 * between locales.
 */

import type { LessonDocIssue } from './schema.js';

type Json = Record<string, unknown>;

/** Attributes that must be identical between source and translation. */
export const LOCKED_BLOCK_ATTRS: Readonly<Record<string, readonly string[]>> = {
  heading: ['level'],
  orderedList: ['start'],
  callout: ['kind'],
  codeBlock: ['language', 'showLineNumbers', 'highlightLines', 'copyable'],
  image: ['src', 'assetId', 'width', 'align'],
  embed: ['provider', 'url', 'aspectRatio'],
  videoBlock: ['assetId', 'posterSrc', 'durationSec'],
  quiz: ['id', 'kind', 'correctOptionIds'],
  exerciseRef: ['exerciseId'],
  aiPromptRef: ['aiPromptId'],
  scenarioRef: ['scenarioId'],
  tableCell: ['colspan', 'rowspan'],
  tableHeader: ['colspan', 'rowspan'],
};

const INLINE = new Set(['text', 'hardBreak']);

function obj(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

function blocks(v: unknown): Json[] {
  return Array.isArray(v)
    ? v.map(obj).filter((n): n is Json => !!n && !INLINE.has(String(n['type'])))
    : [];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function ids(list: unknown): string[] {
  return Array.isArray(list)
    ? list.map((o) => String(obj(o)?.['id'] ?? ''))
    : [];
}

/**
 * Problems that make `translated` structurally different from `source`;
 * empty when the translation only changes translatable text. Paths point
 * into the translated doc (`content.3.attrs.id`).
 */
export function lessonStructureIssues(
  source: unknown,
  translated: unknown,
): LessonDocIssue[] {
  const issues: LessonDocIssue[] = [];
  const push = (path: string, message: string) =>
    issues.push({ path, code: 'structure_mismatch', message });

  const walk = (a: Json[], b: Json[], path: string): void => {
    if (a.length !== b.length) {
      push(
        path || 'content',
        `Expected ${a.length} block(s) here like the source, found ${b.length}`,
      );
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const here = `${path ? `${path}.` : ''}content.${i}`;
      const s = a[i];
      const t = b[i];
      const type = String(s['type']);
      if (type !== String(t['type'])) {
        push(
          `${here}.type`,
          `Expected a "${type}" block like the source, found "${String(t['type'])}"`,
        );
        continue;
      }
      const sa = obj(s['attrs']) ?? {};
      const ta = obj(t['attrs']) ?? {};
      for (const key of LOCKED_BLOCK_ATTRS[type] ?? []) {
        if (!same(sa[key], ta[key]))
          push(`${here}.attrs.${key}`, `"${key}" must match the source`);
      }
      if (type === 'quiz') {
        if (!same(ids(sa['options']), ids(ta['options'])))
          push(`${here}.attrs.options`, 'Quiz options must match the source');
        if (!same(ids(sa['targets']), ids(ta['targets'])))
          push(`${here}.attrs.targets`, 'Quiz answers must match the source');
      }
      walk(blocks(s['content']), blocks(t['content']), here);
    }
  };

  const s = obj(source);
  const t = obj(translated);
  if (!s || !t) {
    push('', 'Not a lesson document');
    return issues;
  }
  walk(blocks(s['content']), blocks(t['content']), '');
  return issues;
}
