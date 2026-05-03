/**
 * Runtime validation. Used by:
 *   - admin save path (client-side check before POST)
 *   - API ingest (server-side check before persisting)
 *   - migration framework (validate after each migration step)
 *
 * The shape mirrors `LessonDoc` in types.ts. Keep them in sync.
 */

import { z } from 'zod';

const TextMark = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({ type: z.literal('underline') }),
  z.object({ type: z.literal('strike') }),
  z.object({ type: z.literal('code') }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: z.string().url(),
      target: z.string().nullable().optional(),
    }),
  }),
]);

const TextNode = z.object({
  type: z.literal('text'),
  text: z.string(),
  marks: z.array(TextMark).optional(),
});

const InlineContent = z.array(TextNode);

// ProseMirror lists nest blocks recursively; declare the schema lazily.
type BlockSchema = z.ZodType<unknown>;
const Block: BlockSchema = z.lazy((): BlockSchema =>
  z.union([
    Paragraph,
    Heading,
    BulletList,
    OrderedList,
    ListItem,
    Blockquote,
    Callout,
    CodeBlock,
    Divider,
  ]),
);

const Paragraph = z.object({
  type: z.literal('paragraph'),
  content: InlineContent.optional(),
});

const Heading = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: InlineContent.optional(),
});

const ListItem: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    content: z.array(Block).min(1),
  }),
);

const BulletList = z.object({
  type: z.literal('bulletList'),
  content: z.array(ListItem).min(1),
});

const OrderedList = z.object({
  type: z.literal('orderedList'),
  attrs: z.object({ start: z.number().int().positive().optional() }).optional(),
  content: z.array(ListItem).min(1),
});

const Blockquote: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.literal('blockquote'),
    content: z.array(Block).min(1),
  }),
);

const Callout: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.literal('callout'),
    attrs: z.object({
      kind: z.enum(['info', 'tip', 'warn', 'danger', 'success']),
    }),
    content: z.array(Block).min(1),
  }),
);

const CodeBlock = z.object({
  type: z.literal('codeBlock'),
  attrs: z.object({
    language: z.string().min(1),
    showLineNumbers: z.boolean().optional(),
    highlightLines: z.string().optional(),
  }),
  content: InlineContent.optional(),
});

const Divider = z.object({
  type: z.literal('horizontalRule'),
});

export const lessonDocSchema = z.object({
  type: z.literal('doc'),
  version: z.number().int().positive(),
  attrs: z.object({ sourceLocale: z.string().optional() }).optional(),
  content: z.array(Block),
});

export type LessonDocInput = z.input<typeof lessonDocSchema>;
