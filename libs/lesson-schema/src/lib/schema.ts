/**
 * Runtime validation. Used by:
 *   - admin save path (client-side check before PATCH)
 *   - API ingest (server-side check before persisting — docs/14 §3)
 *   - migration framework (validate after each migration step)
 *
 * The shape mirrors `LessonDoc` in types.ts. Keep them in sync. Object
 * schemas strip unknown keys, so the parsed output is the whitelisted doc
 * the API persists.
 *
 * Optional attrs accept `null` because Tiptap's `getJSON()` serializes
 * every declared attribute, using `null` for "unset".
 */

import { z } from 'zod';
import { embedSrcFor, isAllowedHref, isAllowedImageSrc } from './urls.js';
import {
  EMBED_ASPECT_RATIOS,
  EMBED_PROVIDERS,
  IMAGE_ALIGNS,
  QUIZ_KINDS,
  type NestableBlockNode,
} from './types.js';

// Explicit type for the recursive edges so TS doesn't chase the cycle.
type NestableArray = z.ZodArray<z.ZodType<NestableBlockNode>>;

/** Hard size limit for a stored doc (docs/06 §11). */
export const LESSON_DOC_MAX_BYTES = 500_000;

/** Opaque ids (uuid v7 rows, nanoid-style quiz/option ids). */
const ID = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Must be 1-64 chars of [A-Za-z0-9_-]');

// ─── Marks & inline ────────────────────────────────────────────────────────
const Mark = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({ type: z.literal('underline') }),
  z.object({ type: z.literal('strike') }),
  z.object({ type: z.literal('code') }),
  z.object({ type: z.literal('highlight') }),
  z.object({ type: z.literal('kbd') }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: z.string().refine(isAllowedHref, {
        message:
          'Link must be http(s):, mailto:, a /relative path or a #anchor',
      }),
      target: z.enum(['_blank', '_self']).nullish(),
    }),
  }),
]);

const TextNode = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(Mark).optional(),
});

const PlainTextNode = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
});

const HardBreak = z.object({ type: z.literal('hardBreak') });

const InlineContent = z.array(
  z.discriminatedUnion('type', [TextNode, HardBreak]),
);

// ─── Leaf / text blocks ────────────────────────────────────────────────────
const Paragraph = z.object({
  type: z.literal('paragraph'),
  content: InlineContent.optional(),
});

const Heading = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: InlineContent.optional(),
});

const CodeBlock = z.object({
  type: z.literal('codeBlock'),
  attrs: z.object({
    language: z
      .string()
      .regex(/^[A-Za-z0-9+#._-]{1,40}$/, 'Invalid code language')
      .nullish()
      .transform((v) => v ?? 'plaintext'),
    showLineNumbers: z.boolean().nullish(),
    highlightLines: z
      .string()
      .regex(/^[\d,\s-]*$/, 'Use line numbers and ranges, e.g. "3,7-9"')
      .nullish(),
    copyable: z.boolean().nullish(),
  }),
  content: z.array(PlainTextNode).optional(),
});

const Divider = z.object({ type: z.literal('horizontalRule') });

const Image = z.object({
  type: z.literal('image'),
  attrs: z.object({
    src: z.string().refine(isAllowedImageSrc, {
      message: 'Image src must be an http(s) URL or a /relative path',
    }),
    alt: z.string().trim().min(1, 'Images need alt text').max(500),
    caption: z.string().max(500).nullish(),
    assetId: ID.nullish(),
    width: z.enum(['full', 'wide', 'inline']).nullish(),
    align: z.enum(IMAGE_ALIGNS).nullish(),
  }),
});

// ─── Containers (recursive via getters) ────────────────────────────────────
// Getter-based recursion keeps every member a plain ZodObject so the unions
// below can be discriminated on `type` (clear "unknown block" errors).

const ListItem = z.object({
  type: z.literal('listItem'),
  get content(): NestableArray {
    return z.array(NestableBlock).min(1) as unknown as NestableArray;
  },
});

const BulletList = z.object({
  type: z.literal('bulletList'),
  content: z.array(ListItem).min(1),
});

const OrderedList = z.object({
  type: z.literal('orderedList'),
  attrs: z.object({ start: z.number().int().min(0).nullish() }).nullish(),
  content: z.array(ListItem).min(1),
});

const Blockquote = z.object({
  type: z.literal('blockquote'),
  get content(): NestableArray {
    return z.array(NestableBlock).min(1) as unknown as NestableArray;
  },
});

/** Blocks allowed at the root AND inside listItem/blockquote/callout/cells. */
const NestableBlock = z.discriminatedUnion('type', [
  Paragraph,
  Heading,
  BulletList,
  OrderedList,
  Blockquote,
  CodeBlock,
  Divider,
  Image,
]);

const Callout = z.object({
  type: z.literal('callout'),
  attrs: z.object({
    kind: z.enum(['info', 'tip', 'warn', 'danger', 'success']),
  }),
  content: z.array(NestableBlock).min(1),
});

const CellAttrs = z
  .object({
    colspan: z.number().int().min(1).max(50).nullish(),
    rowspan: z.number().int().min(1).max(50).nullish(),
    colwidth: z.array(z.number().int().min(0).max(4000)).nullish(),
  })
  .nullish();

const TableHeader = z.object({
  type: z.literal('tableHeader'),
  attrs: CellAttrs,
  content: z.array(NestableBlock).min(1),
});

const TableCell = z.object({
  type: z.literal('tableCell'),
  attrs: CellAttrs,
  content: z.array(NestableBlock).min(1),
});

const TableRow = z.object({
  type: z.literal('tableRow'),
  content: z
    .array(z.discriminatedUnion('type', [TableHeader, TableCell]))
    .min(1),
});

const Table = z.object({
  type: z.literal('table'),
  content: z.array(TableRow).min(1),
});

// ─── Media & interactive (root-only) ───────────────────────────────────────
const Embed = z
  .object({
    type: z.literal('embed'),
    attrs: z.object({
      provider: z.enum(EMBED_PROVIDERS),
      url: z.string(),
      title: z.string().trim().min(1, 'Embeds need a title').max(200),
      aspectRatio: z.enum(EMBED_ASPECT_RATIOS).nullish(),
      meta: z
        .object({
          title: z.string().max(300).nullish(),
          authorName: z.string().max(200).nullish(),
          providerName: z.string().max(100).nullish(),
          thumbnailUrl: z
            .string()
            .max(2048)
            .refine((v) => v.startsWith('https://') && isAllowedImageSrc(v), {
              message: 'Thumbnail must be an https URL',
            })
            .nullish(),
          fetchedAt: z.string().max(40).nullish(),
        })
        .nullish(),
    }),
  })
  .superRefine((node, ctx) => {
    if (!embedSrcFor(node.attrs.provider, node.attrs.url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attrs', 'url'],
        message: `URL is not a recognised ${node.attrs.provider} link`,
      });
    }
  });

const QuizOptionSchema = z.object({
  id: ID,
  text: z.string().trim().min(1, 'Option text is required').max(500),
});

/** `left:right` token of a match quiz key/answer. */
const PAIR = /^([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64})$/;

export const quizAttrsSchema = z
  .object({
    id: ID,
    question: z.string().trim().min(1, 'Quiz question is required').max(1000),
    kind: z.enum(QUIZ_KINDS),
    options: z
      .array(QuizOptionSchema)
      .min(2, 'A quiz needs at least 2 options')
      .max(10, 'A quiz can have at most 10 options'),
    targets: z
      .array(QuizOptionSchema)
      .max(12, 'A match quiz can have at most 12 answers')
      .nullish(),
    correctOptionIds: z
      .array(z.string().max(130))
      .min(1, 'Mark at least one option as correct'),
    explanation: z.string().max(2000).nullish(),
  })
  .superRefine((q, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const ids = q.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length)
      issue(['options'], 'Option ids must be unique');
    if (new Set(q.correctOptionIds).size !== q.correctOptionIds.length)
      issue(['correctOptionIds'], 'Duplicate correct option ids');

    if (q.kind === 'match') {
      const targets = q.targets ?? [];
      const targetIds = targets.map((t) => t.id);
      if (targets.length < q.options.length)
        issue(['targets'], 'Every left-hand item needs a matching answer');
      if (new Set(targetIds).size !== targetIds.length)
        issue(['targets'], 'Answer ids must be unique');
      const lefts = new Set<string>();
      const rights = new Set<string>();
      q.correctOptionIds.forEach((token, i) => {
        const m = PAIR.exec(token);
        if (!m || !ids.includes(m[1]) || !targetIds.includes(m[2])) {
          issue(['correctOptionIds', i], `Unknown pair "${token}"`);
          return;
        }
        if (lefts.has(m[1]) || rights.has(m[2]))
          issue(['correctOptionIds', i], 'Each item and answer pairs once');
        lefts.add(m[1]);
        rights.add(m[2]);
      });
      if (lefts.size !== ids.length)
        issue(['correctOptionIds'], 'Pair every left-hand item with an answer');
      return;
    }
    if (q.targets && q.targets.length > 0)
      issue(['targets'], 'Only match quizzes have answers on the right');

    const unknown = q.correctOptionIds.filter((id) => !ids.includes(id));
    if (unknown.length)
      issue(['correctOptionIds'], `Unknown option ids: ${unknown.join(', ')}`);
    if (q.kind === 'order') {
      if (q.correctOptionIds.length !== ids.length)
        issue(
          ['correctOptionIds'],
          'Order quizzes list every option in the correct order',
        );
      return;
    }
    if (q.kind === 'single' && q.correctOptionIds.length !== 1)
      issue(
        ['correctOptionIds'],
        'Single-choice quizzes need exactly one correct option',
      );
  });

const Quiz = z.object({
  type: z.literal('quiz'),
  attrs: quizAttrsSchema,
});

const VideoBlock = z.object({
  type: z.literal('videoBlock'),
  attrs: z.object({
    assetId: ID.nullish(),
    title: z.string().trim().min(1, 'Videos need a title').max(200),
    caption: z.string().max(500).nullish(),
    posterSrc: z
      .string()
      .refine(isAllowedImageSrc, {
        message: 'Poster must be an http(s) URL or a /relative path',
      })
      .nullish(),
    durationSec: z.number().int().min(0).max(86_400).nullish(),
  }),
});

const ExerciseRef = z.object({
  type: z.literal('exerciseRef'),
  attrs: z.object({ exerciseId: ID }),
});

const AiPromptRef = z.object({
  type: z.literal('aiPromptRef'),
  attrs: z.object({ aiPromptId: ID }),
});

const ScenarioRef = z.object({
  type: z.literal('scenarioRef'),
  attrs: z.object({ scenarioId: ID }),
});

/** Every block allowed at the doc root. */
const RootBlock = z.discriminatedUnion('type', [
  Paragraph,
  Heading,
  BulletList,
  OrderedList,
  Blockquote,
  CodeBlock,
  Divider,
  Image,
  Callout,
  Table,
  Embed,
  VideoBlock,
  Quiz,
  ExerciseRef,
  AiPromptRef,
  ScenarioRef,
]);

export const lessonDocSchema = z
  .object({
    type: z.literal('doc'),
    version: z.number().int().positive(),
    attrs: z.object({ sourceLocale: z.string().max(20).nullish() }).nullish(),
    content: z.array(RootBlock),
  })
  .superRefine((doc, ctx) => {
    const seen = new Map<string, number>();
    doc.content.forEach((block, i) => {
      if (block.type !== 'quiz') return;
      const prev = seen.get(block.attrs.id);
      if (prev !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['content', i, 'attrs', 'id'],
          message: `Duplicate quiz id "${block.attrs.id}" (also at content.${prev})`,
        });
      } else {
        seen.set(block.attrs.id, i);
      }
    });
  });

export type LessonDocInput = z.input<typeof lessonDocSchema>;
export type LessonDocOutput = z.output<typeof lessonDocSchema>;

export interface LessonDocIssue {
  /** Dotted path into the doc, e.g. `content.3.attrs.alt`. */
  path: string;
  code: string;
  message: string;
}

/** Flatten zod issues into a transport-friendly list (API 400 bodies, editor UI). */
export function formatLessonDocIssues(error: z.ZodError): LessonDocIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

export type ValidateLessonDocResult =
  | { ok: true; doc: LessonDocOutput }
  | { ok: false; issues: LessonDocIssue[] };

/** Non-throwing validation. */
export function validateLessonDoc(input: unknown): ValidateLessonDocResult {
  const parsed = lessonDocSchema.safeParse(input);
  return parsed.success
    ? { ok: true, doc: parsed.data }
    : { ok: false, issues: formatLessonDocIssues(parsed.error) };
}
