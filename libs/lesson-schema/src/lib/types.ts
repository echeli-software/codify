/**
 * Document shape stored in `Lesson.contentJson`. The Tiptap editor reads + writes
 * this shape; the read-only renderer interprets it. See docs/06-content-authoring.md.
 *
 * Bumping LESSON_DOC_VERSION requires registering a migration in ./migrate.ts.
 *
 * Nesting model (enforced by `lessonDocSchema` and mirrored by the editor's
 * Tiptap content expressions):
 *   - "nestable" blocks (paragraph, heading, lists, blockquote, codeBlock,
 *     horizontalRule, image) may appear at the doc root and inside
 *     containers (listItem, blockquote, callout, table cells);
 *   - "root-only" blocks (callout, table, embed, videoBlock, quiz,
 *     exerciseRef, aiPromptRef, scenarioRef) may only appear at the doc root;
 *   - `listItem` only ever appears directly inside bulletList / orderedList.
 */

export const LESSON_DOC_VERSION = 1;

// ─── Marks ─────────────────────────────────────────────────────────────────
export type LinkTarget = '_blank' | '_self';

export type MarkType =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight' }
  | { type: 'kbd' }
  | { type: 'link'; attrs: { href: string; target?: LinkTarget | null } };

export type MarkName = MarkType['type'];

// ─── Inline ────────────────────────────────────────────────────────────────
export interface TextNode {
  type: 'text';
  text: string;
  marks?: MarkType[];
}

/** Soft line break (Shift+Enter in the editor). */
export interface HardBreakNode {
  type: 'hardBreak';
}

export type InlineNode = TextNode | HardBreakNode;

// ─── Text & structure blocks ───────────────────────────────────────────────
export interface ParagraphNode {
  type: 'paragraph';
  content?: InlineNode[];
}

export interface HeadingNode {
  type: 'heading';
  attrs: { level: 2 | 3 };
  content?: InlineNode[];
}

export interface BulletListNode {
  type: 'bulletList';
  content: ListItemNode[];
}

export interface OrderedListNode {
  type: 'orderedList';
  attrs?: { start?: number | null };
  content: ListItemNode[];
}

export interface ListItemNode {
  type: 'listItem';
  content: NestableBlockNode[];
}

export interface BlockquoteNode {
  type: 'blockquote';
  content: NestableBlockNode[];
}

export type CalloutKind = 'info' | 'tip' | 'warn' | 'danger' | 'success';

export interface CalloutNode {
  type: 'callout';
  attrs: { kind: CalloutKind };
  content: NestableBlockNode[];
}

export interface CodeBlockNode {
  type: 'codeBlock';
  attrs: {
    language: string;
    showLineNumbers?: boolean | null;
    /** 1-based lines and ranges to emphasise, e.g. `"3,7-9"`. */
    highlightLines?: string | null;
    /** Show a copy-to-clipboard button (default true). */
    copyable?: boolean | null;
  };
  content?: TextNode[];
}

export interface DividerNode {
  type: 'horizontalRule';
}

// ─── Media ─────────────────────────────────────────────────────────────────
export type ImageWidth = 'full' | 'wide' | 'inline';
export const IMAGE_ALIGNS = ['left', 'center', 'right'] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

export interface ImageNode {
  type: 'image';
  attrs: {
    /** http(s) URL or same-origin path. Never data:/javascript:. */
    src: string;
    /** Required for accessibility. */
    alt: string;
    caption?: string | null;
    /** Media-library Asset id when uploaded through the asset pipeline. */
    assetId?: string | null;
    width?: ImageWidth | null;
    /** Horizontal placement (default `center`); only visible below full width. */
    align?: ImageAlign | null;
  };
}

export const EMBED_PROVIDERS = [
  'youtube',
  'vimeo',
  'codepen',
  'codesandbox',
  'loom',
  'stackblitz',
  'figma',
] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export const EMBED_ASPECT_RATIOS = [
  '16:9',
  '4:3',
  '1:1',
  '9:16',
  '21:9',
] as const;
export type EmbedAspectRatio = (typeof EMBED_ASPECT_RATIOS)[number];

/**
 * oEmbed-style metadata the API fetches from the provider's fixed oEmbed
 * endpoint when the lesson is saved (never from the author's URL). Absent
 * when the provider has no oEmbed endpoint or the fetch failed.
 */
export interface EmbedMeta {
  title?: string | null;
  authorName?: string | null;
  providerName?: string | null;
  /** https only. */
  thumbnailUrl?: string | null;
  /** When the metadata was fetched (ISO). */
  fetchedAt?: string | null;
}

export interface EmbedNode {
  type: 'embed';
  attrs: {
    provider: EmbedProvider;
    /** The public URL the author pasted. Must match the provider's host patterns. */
    url: string;
    /** Accessible iframe title. */
    title: string;
    /** Frame shape (default 16:9). */
    aspectRatio?: EmbedAspectRatio | null;
    /** Filled in server-side on save. */
    meta?: EmbedMeta | null;
  };
}

/**
 * Video block (docs/06 §3): the shape is final, but until the Cloudflare
 * Stream pipeline lands renderers show a "video coming soon" placeholder.
 */
export interface VideoBlockNode {
  type: 'videoBlock';
  attrs: {
    /** Media-library / Stream asset id, once the pipeline exists. */
    assetId?: string | null;
    /** Accessible title. */
    title: string;
    caption?: string | null;
    /** Poster image (http(s) or same-origin path). */
    posterSrc?: string | null;
    durationSec?: number | null;
  };
}

// ─── Tables ────────────────────────────────────────────────────────────────
export interface TableCellAttrs {
  colspan?: number | null;
  rowspan?: number | null;
  colwidth?: number[] | null;
}

export interface TableHeaderNode {
  type: 'tableHeader';
  attrs?: TableCellAttrs;
  content: NestableBlockNode[];
}

export interface TableCellNode {
  type: 'tableCell';
  attrs?: TableCellAttrs;
  content: NestableBlockNode[];
}

export interface TableRowNode {
  type: 'tableRow';
  content: (TableHeaderNode | TableCellNode)[];
}

export interface TableNode {
  type: 'table';
  content: TableRowNode[];
}

// ─── Interactive blocks ────────────────────────────────────────────────────
export const QUIZ_KINDS = ['single', 'multiple', 'match', 'order'] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export interface QuizOption {
  id: string;
  text: string;
}

/**
 * Quiz kinds and their answer keys / answers. Every answer is a list of
 * string tokens compared as a SET, so grading and the offline answer hashes
 * (`hashQuizAnswer`) work the same for every kind:
 *
 *   - `single` / `multiple`: option ids.
 *   - `match`: `options` are the left-hand prompts, `targets` the right-hand
 *     answers (may include distractors). Key and answer tokens are
 *     `"<optionId>:<targetId>"`, one per option.
 *   - `order`: `correctOptionIds` is the full correct sequence of option
 *     ids. Answers are position tokens `"<index>:<optionId>"` (0-based) —
 *     see `orderAnswerTokens` / `orderFromTokens`.
 */
export interface QuizAttrs {
  /** Unique within the doc; the key in quiz answer maps. */
  id: string;
  question: string;
  kind: QuizKind;
  options: QuizOption[];
  /** Right-hand items of a `match` quiz (absent for other kinds). */
  targets?: QuizOption[] | null;
  /**
   * Answer key (see above). Always present in authored docs (the schema
   * requires it); ABSENT in docs delivered to students (see
   * `stripQuizAnswers`, which also shuffles `order` options and `match`
   * targets so their array order can't give the answer away).
   */
  correctOptionIds?: string[];
  /** Shown after answering. Stripped from student-delivered docs. */
  explanation?: string | null;
}

export interface QuizNode {
  type: 'quiz';
  attrs: QuizAttrs;
}

export interface ExerciseRefNode {
  type: 'exerciseRef';
  attrs: { exerciseId: string };
}

export interface AiPromptRefNode {
  type: 'aiPromptRef';
  attrs: { aiPromptId: string };
}

export interface ScenarioRefNode {
  type: 'scenarioRef';
  attrs: { scenarioId: string };
}

export type RefNode = ExerciseRefNode | AiPromptRefNode | ScenarioRefNode;
export type RefBlockType = RefNode['type'];

// ─── Unions ────────────────────────────────────────────────────────────────

/** Blocks allowed both at the root and inside containers. */
export type NestableBlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | CodeBlockNode
  | DividerNode
  | ImageNode;

/** Blocks allowed only at the doc root. */
export type RootOnlyBlockNode =
  | CalloutNode
  | TableNode
  | EmbedNode
  | VideoBlockNode
  | QuizNode
  | ExerciseRefNode
  | AiPromptRefNode
  | ScenarioRefNode;

/** Every block allowed at the doc root. */
export type BlockNode = NestableBlockNode | RootOnlyBlockNode;

/** Every node type that can appear anywhere in a doc (blocks + structural children). */
export type AnyBlockNode =
  | BlockNode
  | ListItemNode
  | TableRowNode
  | TableHeaderNode
  | TableCellNode;

export type BlockType = AnyBlockNode['type'];

export interface LessonDoc {
  type: 'doc';
  /** Schema version at save time. Equal to LESSON_DOC_VERSION when fresh. */
  version: number;
  attrs?: { sourceLocale?: string | null };
  content: BlockNode[];
}
