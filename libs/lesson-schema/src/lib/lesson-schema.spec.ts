import {
  emptyLessonDoc,
  lessonDocSchema,
  validateLessonDoc,
  migrateLessonDoc,
  registeredMigrationTargets,
  LESSON_DOC_VERSION,
  LESSON_BLOCK_REGISTRY,
  NESTABLE_PARENTS,
  enabledBlocks,
  insertableBlocks,
  kitchenSinkLessonDoc,
  isAllowedHref,
  isAllowedImageSrc,
  embedSrcFor,
  parseEmbedUrl,
  collectLessonRefs,
  LessonDocMigrationError,
  type LessonDoc,
  type BlockParent,
} from '../index.js';

const doc = (content: unknown[]): unknown => ({
  type: 'doc',
  version: LESSON_DOC_VERSION,
  content,
});
const p = (text = 'x') => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const ok = (d: unknown) => lessonDocSchema.safeParse(d).success;

describe('lessonDocSchema — documents', () => {
  it('validates a fresh empty doc', () => {
    expect(ok(emptyLessonDoc())).toBe(true);
  });

  it('validates the kitchen-sink doc containing every block and mark', () => {
    const result = validateLessonDoc(kitchenSinkLessonDoc());
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.ok).toBe(true);
  });

  it('rejects unknown block types with a path', () => {
    const res = validateLessonDoc(
      doc([{ type: 'unknown-block', content: [] }]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0].path).toBe('content.0.type');
  });

  it('rejects headings outside levels 2 / 3', () => {
    expect(
      ok(doc([{ type: 'heading', attrs: { level: 1 }, content: [] }])),
    ).toBe(false);
    expect(ok(doc([{ type: 'heading', attrs: { level: 3 } }]))).toBe(true);
  });

  it('accepts hardBreak inline nodes and rejects empty text nodes', () => {
    expect(
      ok(doc([{ type: 'paragraph', content: [{ type: 'hardBreak' }] }])),
    ).toBe(true);
    expect(
      ok(doc([{ type: 'paragraph', content: [{ type: 'text', text: '' }] }])),
    ).toBe(false);
  });

  it('accepts null attrs the way Tiptap serializes them', () => {
    expect(
      ok(
        doc([
          {
            type: 'codeBlock',
            attrs: { language: null },
            content: [{ type: 'text', text: 'x' }],
          },
          {
            type: 'orderedList',
            attrs: { start: 1, type: null },
            content: [{ type: 'listItem', content: [p()] }],
          },
          {
            type: 'image',
            attrs: {
              src: '/a.png',
              alt: 'A',
              caption: null,
              assetId: null,
              width: null,
            },
          },
        ]),
      ),
    ).toBe(true);
  });

  it('normalizes a null code language to plaintext and strips unknown keys', () => {
    const parsed = lessonDocSchema.parse(
      doc([
        { type: 'codeBlock', attrs: { language: null, evil: 1 }, content: [] },
      ]),
    ) as unknown as { content: { attrs: Record<string, unknown> }[] };
    expect(parsed.content[0].attrs['language']).toBe('plaintext');
    expect(parsed.content[0].attrs['evil']).toBeUndefined();
  });

  it('rejects duplicate quiz ids across the doc', () => {
    const quiz = kitchenSinkLessonDoc().content.find((b) => b.type === 'quiz');
    const res = validateLessonDoc(doc([quiz, quiz]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0].message).toMatch(/Duplicate quiz id/);
  });
});

describe('lessonDocSchema — marks', () => {
  const linked = (href: string) =>
    doc([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'l',
            marks: [{ type: 'link', attrs: { href } }],
          },
        ],
      },
    ]);

  it.each([
    'https://a.dev/x',
    'http://a.dev',
    'mailto:hi@a.dev',
    '/courses/1',
    '#intro',
  ])('accepts link href %s', (href) => expect(ok(linked(href))).toBe(true));

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'file:///etc/passwd',
    '//evil.example/x',
    '/\\evil.example',
    'https://a.dev/ x',
    '',
    'not a url',
  ])('rejects link href %s', (href) => expect(ok(linked(href))).toBe(false));

  it('accepts highlight and kbd marks, rejects unknown marks', () => {
    const withMark = (type: string) =>
      doc([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'k', marks: [{ type }] }],
        },
      ]);
    expect(ok(withMark('highlight'))).toBe(true);
    expect(ok(withMark('kbd'))).toBe(true);
    expect(ok(withMark('textStyle'))).toBe(false);
  });
});

describe('lessonDocSchema — nesting rules', () => {
  const li = { type: 'listItem', content: [p()] };

  it('rejects listItem at the doc root', () => {
    expect(ok(doc([li]))).toBe(false);
  });

  it('rejects listItem directly inside callout or blockquote', () => {
    expect(
      ok(doc([{ type: 'callout', attrs: { kind: 'info' }, content: [li] }])),
    ).toBe(false);
    expect(ok(doc([{ type: 'blockquote', content: [li] }]))).toBe(false);
  });

  it('rejects callouts nested in callouts, directly or through a blockquote', () => {
    const inner = { type: 'callout', attrs: { kind: 'info' }, content: [p()] };
    expect(
      ok(doc([{ type: 'callout', attrs: { kind: 'info' }, content: [inner] }])),
    ).toBe(false);
    expect(
      ok(
        doc([
          {
            type: 'callout',
            attrs: { kind: 'info' },
            content: [{ type: 'blockquote', content: [inner] }],
          },
        ]),
      ),
    ).toBe(false);
  });

  it('rejects empty lists and empty containers', () => {
    expect(ok(doc([{ type: 'bulletList', content: [] }]))).toBe(false);
    expect(ok(doc([{ type: 'blockquote', content: [] }]))).toBe(false);
  });

  // Generate one valid sample per block type, then try it in every
  // container; the verdict must match the registry's `allowedIn`.
  const samples: Record<string, unknown> = {};
  for (const block of kitchenSinkLessonDoc().content)
    samples[block.type] ??= block;
  samples['paragraph'] = p();

  const wrap = (parent: BlockParent, child: unknown): unknown => {
    switch (parent) {
      case 'doc':
        return doc([child]);
      case 'listItem':
        return doc([
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [child] }],
          },
        ]);
      case 'blockquote':
        return doc([{ type: 'blockquote', content: [child] }]);
      case 'callout':
        return doc([
          { type: 'callout', attrs: { kind: 'info' }, content: [child] },
        ]);
      case 'tableHeader':
      case 'tableCell':
        return doc([
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [{ type: parent, content: [child] }],
              },
            ],
          },
        ]);
      default:
        throw new Error(`no wrapper for ${parent}`);
    }
  };

  const insertable = LESSON_BLOCK_REGISTRY.filter((b) => b.insertable);
  for (const entry of insertable) {
    for (const parent of NESTABLE_PARENTS) {
      const expected = entry.allowedIn.includes(parent);
      it(`${entry.type} inside ${parent} → ${expected ? 'allowed' : 'rejected'}`, () => {
        expect(samples[entry.type]).toBeDefined();
        expect(ok(wrap(parent, samples[entry.type]))).toBe(expected);
      });
    }
  }
});

describe('lessonDocSchema — media', () => {
  const img = (attrs: Record<string, unknown>) =>
    doc([
      {
        type: 'image',
        attrs: { src: 'https://cdn.x/a.png', alt: 'A', ...attrs },
      },
    ]);

  it('requires non-blank alt text on images', () => {
    expect(ok(img({ alt: '' }))).toBe(false);
    expect(ok(img({ alt: '   ' }))).toBe(false);
    expect(ok(img({ alt: undefined }))).toBe(false);
  });

  it('rejects data: and javascript: image sources', () => {
    expect(ok(img({ src: 'data:image/svg+xml,<svg onload=alert(1)>' }))).toBe(
      false,
    );
    expect(ok(img({ src: 'javascript:alert(1)' }))).toBe(false);
    expect(ok(img({ src: '/uploads/a.png' }))).toBe(true);
  });

  it('rejects unknown image widths', () => {
    expect(ok(img({ width: 'huge' }))).toBe(false);
    expect(ok(img({ width: 'inline' }))).toBe(true);
  });

  const embed = (provider: string, url: string, title = 'T') =>
    doc([{ type: 'embed', attrs: { provider, url, title } }]);

  it.each([
    ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['youtube', 'https://youtu.be/dQw4w9WgXcQ?t=42'],
    ['youtube', 'https://www.youtube.com/shorts/dQw4w9WgXcQ'],
    ['vimeo', 'https://vimeo.com/76979871'],
    ['vimeo', 'https://player.vimeo.com/video/76979871?h=abcdef12'],
    ['codepen', 'https://codepen.io/someone/pen/abcDEF1'],
    ['codesandbox', 'https://codesandbox.io/s/react-new-x1y2z'],
    ['codesandbox', 'https://codesandbox.io/p/sandbox/abc123'],
    ['loom', 'https://www.loom.com/share/0123456789abcdef0123456789abcdef'],
  ])('accepts %s embed %s', (provider, url) =>
    expect(ok(embed(provider, url))).toBe(true),
  );

  it.each([
    ['youtube', 'https://evil.example/watch?v=dQw4w9WgXcQ'],
    ['youtube', 'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
    ['youtube', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['youtube', 'https://vimeo.com/76979871'],
    ['vimeo', 'https://vimeo.com/channels/staff'],
    ['codepen', 'https://codepen.io/someone'],
    ['loom', 'javascript:alert(1)'],
    ['figma', 'https://www.figma.com/file/abc'],
  ])('rejects %s embed %s', (provider, url) =>
    expect(ok(embed(provider, url))).toBe(false),
  );

  it('requires an embed title', () => {
    expect(ok(embed('youtube', 'https://youtu.be/dQw4w9WgXcQ', ''))).toBe(
      false,
    );
  });
});

describe('lessonDocSchema — quiz', () => {
  const quiz = (attrs: Record<string, unknown>) =>
    doc([
      {
        type: 'quiz',
        attrs: {
          id: 'q1',
          question: 'Q?',
          kind: 'single',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['a'],
          ...attrs,
        },
      },
    ]);

  it('accepts a valid single-choice quiz', () =>
    expect(ok(quiz({}))).toBe(true));
  it('needs ≥ 2 options', () =>
    expect(ok(quiz({ options: [{ id: 'a', text: 'A' }] }))).toBe(false));
  it('needs ≥ 1 correct option', () =>
    expect(ok(quiz({ correctOptionIds: [] }))).toBe(false));
  it('single needs exactly one correct', () =>
    expect(ok(quiz({ correctOptionIds: ['a', 'b'] }))).toBe(false));
  it('multiple accepts several correct', () =>
    expect(ok(quiz({ kind: 'multiple', correctOptionIds: ['a', 'b'] }))).toBe(
      true,
    ));
  it('rejects correct ids that are not options', () =>
    expect(ok(quiz({ correctOptionIds: ['z'] }))).toBe(false));
  it('rejects duplicate option ids', () =>
    expect(
      ok(
        quiz({
          options: [
            { id: 'a', text: 'A' },
            { id: 'a', text: 'B' },
          ],
        }),
      ),
    ).toBe(false));
  it('rejects unknown kinds and blank questions', () => {
    expect(ok(quiz({ kind: 'match' }))).toBe(false);
    expect(ok(quiz({ question: ' ' }))).toBe(false);
  });
  it('rejects ref blocks with malformed ids', () => {
    expect(
      ok(doc([{ type: 'exerciseRef', attrs: { exerciseId: '../etc' } }])),
    ).toBe(false);
    expect(ok(doc([{ type: 'scenarioRef', attrs: {} }]))).toBe(false);
  });
});

describe('url helpers', () => {
  it('embedSrcFor rebuilds a canonical src from the ids only', () => {
    expect(embedSrcFor('youtube', 'https://youtu.be/dQw4w9WgXcQ?t=42s')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42',
    );
    expect(embedSrcFor('vimeo', 'https://vimeo.com/76979871/abcdef12')).toBe(
      'https://player.vimeo.com/video/76979871?h=abcdef12',
    );
    expect(embedSrcFor('codepen', 'https://codepen.io/u/pen/abc')).toBe(
      'https://codepen.io/u/embed/abc?default-tab=result',
    );
    expect(embedSrcFor('loom', 'https://loom.com/share/0123456789abcdef')).toBe(
      'https://www.loom.com/embed/0123456789abcdef',
    );
    expect(
      embedSrcFor('youtube', 'https://user:pw@youtube.com/watch?v=dQw4w9WgXcQ'),
    ).toBeNull();
  });

  it('parseEmbedUrl detects the provider', () => {
    expect(parseEmbedUrl('https://codesandbox.io/embed/abc')?.provider).toBe(
      'codesandbox',
    );
    expect(parseEmbedUrl('https://example.com')).toBeNull();
  });

  it('isAllowedHref / isAllowedImageSrc reject non-strings', () => {
    expect(isAllowedHref(42)).toBe(false);
    expect(isAllowedImageSrc(null)).toBe(false);
  });
});

describe('collectLessonRefs', () => {
  it('lists every external reference in document order', () => {
    const refs = collectLessonRefs(kitchenSinkLessonDoc());
    expect(refs.exerciseIds).toEqual(['0192f3a4-0000-7000-8000-000000000001']);
    expect(refs.aiPromptIds).toEqual(['0192f3a4-0000-7000-8000-000000000002']);
    expect(refs.scenarioIds).toEqual(['0192f3a4-0000-7000-8000-000000000003']);
    expect(refs.assetIds).toEqual(['0192f3a4-sample']);
    expect(refs.imageSrcs).toHaveLength(1);
  });
});

describe('migrateLessonDoc', () => {
  it('returns a copy when already at LESSON_DOC_VERSION', () => {
    const d = emptyLessonDoc();
    const out = migrateLessonDoc(d);
    expect(out.version).toBe(LESSON_DOC_VERSION);
    expect(out).not.toBe(d);
  });

  it('throws when receiving a doc from a newer version', () => {
    expect(() =>
      migrateLessonDoc({
        ...emptyLessonDoc(),
        version: LESSON_DOC_VERSION + 5,
      }),
    ).toThrow(/newer than supported/);
  });

  it('has a registered migration for every version above 1', () => {
    const targets = registeredMigrationTargets();
    for (let v = 2; v <= LESSON_DOC_VERSION; v++) expect(targets).toContain(v);
  });

  it('throws when a step is missing', () => {
    expect(() =>
      migrateLessonDoc(emptyLessonDoc(), { migrations: {}, targetVersion: 2 }),
    ).toThrow(/No migration registered for LessonDoc v1 → v2/);
  });

  describe('round-trip through an injected v2 migration', () => {
    // A realistic v1 → v2 step: default every image's width and ensure a
    // sourceLocale, leaving all other content untouched.
    const v2 = (d: LessonDoc): LessonDoc => ({
      ...d,
      attrs: { sourceLocale: d.attrs?.sourceLocale ?? 'pt-BR' },
      content: d.content.map((b) =>
        b.type === 'image'
          ? { ...b, attrs: { ...b.attrs, width: b.attrs.width ?? 'full' } }
          : b,
      ),
    });

    it('migrates a content-bearing v1 doc, validates, and preserves content', () => {
      const v1 = kitchenSinkLessonDoc();
      v1.version = 1;
      delete v1.attrs;
      const img = v1.content.find((b) => b.type === 'image');
      if (img?.type === 'image') img.attrs.width = null;

      const validated: number[] = [];
      const out = migrateLessonDoc(v1, {
        migrations: { 2: v2 },
        targetVersion: 2,
        validate: (d, version) => {
          validated.push(version);
          lessonDocSchema.parse(d);
        },
      });

      expect(validated).toEqual([2]);
      expect(out.version).toBe(2);
      expect(out.attrs).toEqual({ sourceLocale: 'pt-BR' });
      expect(lessonDocSchema.safeParse(out).success).toBe(true);
      // Every block survives byte-for-byte except the image width default.
      expect(out.content).toHaveLength(v1.content.length);
      out.content.forEach((block, i) => {
        if (block.type === 'image') {
          expect(block.attrs.width).toBe('full');
          expect({ ...block.attrs, width: null }).toEqual(
            (v1.content[i] as typeof block).attrs,
          );
        } else {
          expect(block).toEqual(v1.content[i]);
        }
      });
      // Input untouched (pure).
      expect(v1.version).toBe(1);
    });

    it('fails at the step whose output is invalid, with issues', () => {
      const broken = () => ({
        type: 'doc',
        content: [{ type: 'listItem', content: [] }],
      });
      let caught: unknown;
      try {
        migrateLessonDoc(emptyLessonDoc(), {
          migrations: { 2: v2, 3: broken },
          targetVersion: 3,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(LessonDocMigrationError);
      expect((caught as LessonDocMigrationError).version).toBe(3);
      expect((caught as LessonDocMigrationError).issues.length).toBeGreaterThan(
        0,
      );
    });
  });
});

describe('registry', () => {
  it('enabledBlocks returns at least the v1 set', () => {
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

  it('lists every block of the kitchen-sink doc and uses unique icons for insertable blocks', () => {
    const types = new Set(LESSON_BLOCK_REGISTRY.map((b) => b.type));
    for (const b of kitchenSinkLessonDoc().content)
      expect(types.has(b.type)).toBe(true);
    const icons = insertableBlocks().map((b) => b.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('flags interactive blocks', () => {
    const interactive = LESSON_BLOCK_REGISTRY.filter(
      (b) => b.hasInteractive,
    ).map((b) => b.type);
    expect(interactive.sort()).toEqual([
      'aiPromptRef',
      'exerciseRef',
      'quiz',
      'scenarioRef',
    ]);
  });
});
