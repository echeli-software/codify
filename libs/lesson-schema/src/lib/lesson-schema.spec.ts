import {
  emptyLessonDoc,
  lessonDocSchema,
  migrateLessonDoc,
  LESSON_DOC_VERSION,
  enabledBlocks,
  type LessonDoc,
} from '../index.js';

describe('LessonDoc schema', () => {
  it('validates a fresh empty doc', () => {
    expect(() => lessonDocSchema.parse(emptyLessonDoc())).not.toThrow();
  });

  it('rejects unknown block types', () => {
    const bad = {
      ...emptyLessonDoc(),
      content: [{ type: 'unknown-block', content: [] }],
    };
    expect(() => lessonDocSchema.parse(bad)).toThrow();
  });

  it('accepts a callout containing nested content', () => {
    const doc: LessonDoc = {
      type: 'doc',
      version: LESSON_DOC_VERSION,
      content: [
        {
          type: 'callout',
          attrs: { kind: 'tip' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Heads up.' }] },
          ],
        },
      ],
    };
    expect(() => lessonDocSchema.parse(doc)).not.toThrow();
  });

  it('rejects callouts containing other callouts', () => {
    const bad = {
      type: 'doc',
      version: LESSON_DOC_VERSION,
      content: [
        {
          type: 'callout',
          attrs: { kind: 'info' },
          content: [
            { type: 'callout', attrs: { kind: 'info' }, content: [] },
          ],
        },
      ],
    };
    expect(() => lessonDocSchema.parse(bad)).toThrow();
  });

  it('rejects headings outside levels 2 / 3', () => {
    const bad = {
      type: 'doc',
      version: LESSON_DOC_VERSION,
      content: [{ type: 'heading', attrs: { level: 1 }, content: [] }],
    };
    expect(() => lessonDocSchema.parse(bad)).toThrow();
  });
});

describe('migrateLessonDoc', () => {
  it('returns the same doc when already at LESSON_DOC_VERSION', () => {
    const doc = emptyLessonDoc();
    const out = migrateLessonDoc(doc);
    expect(out.version).toBe(LESSON_DOC_VERSION);
    expect(out).not.toBe(doc); // pure: returns a new object
  });

  it('throws when receiving a doc from a newer version', () => {
    expect(() =>
      migrateLessonDoc({ ...emptyLessonDoc(), version: LESSON_DOC_VERSION + 5 }),
    ).toThrow(/newer than supported/);
  });
});

describe('enabledBlocks', () => {
  it('returns at least the v1 set', () => {
    const types = enabledBlocks().map((b) => b.type);
    for (const t of [
      'heading',
      'bulletList',
      'orderedList',
      'blockquote',
      'codeBlock',
      'callout',
      'horizontalRule',
    ]) {
      expect(types).toContain(t);
    }
  });
});
