/**
 * Document shape stored in `Lesson.contentJson`. The Tiptap editor reads + writes
 * this shape; the read-only renderer interprets it. See docs/06-content-authoring.md.
 *
 * Bumping LESSON_DOC_VERSION requires registering a migration in ./migrate.ts.
 */

export const LESSON_DOC_VERSION = 1;

// ─── Marks ─────────────────────────────────────────────────────────────────
export type MarkType =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'link'; attrs: { href: string; target?: string | null } };

// ─── Text ──────────────────────────────────────────────────────────────────
export interface TextNode {
  type: 'text';
  text: string;
  marks?: MarkType[];
}

// ─── Block nodes ───────────────────────────────────────────────────────────
export interface ParagraphNode {
  type: 'paragraph';
  content?: TextNode[];
}

export interface HeadingNode {
  type: 'heading';
  attrs: { level: 2 | 3 };
  content?: TextNode[];
}

export interface BulletListNode {
  type: 'bulletList';
  content: ListItemNode[];
}

export interface OrderedListNode {
  type: 'orderedList';
  attrs?: { start?: number };
  content: ListItemNode[];
}

export interface ListItemNode {
  type: 'listItem';
  content: BlockNode[];
}

export interface BlockquoteNode {
  type: 'blockquote';
  content: BlockNode[];
}

export type CalloutKind = 'info' | 'tip' | 'warn' | 'danger' | 'success';

export interface CalloutNode {
  type: 'callout';
  attrs: { kind: CalloutKind };
  content: BlockNode[];
}

export interface CodeBlockNode {
  type: 'codeBlock';
  attrs: {
    language: string;
    showLineNumbers?: boolean;
    highlightLines?: string;
  };
  content?: TextNode[];
}

export interface DividerNode {
  type: 'horizontalRule';
}

/**
 * Discriminated union over every supported block node. Add new block types
 * here AND register them in extensions.ts + LESSON_BLOCK_REGISTRY.
 *
 * Interactive blocks (Quiz, ExerciseRef, AiPrompt, Scenario) and asset-
 * dependent blocks (Image, Embed, Video) ship in later phases.
 */
export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | ListItemNode
  | BlockquoteNode
  | CalloutNode
  | CodeBlockNode
  | DividerNode;

export interface LessonDoc {
  type: 'doc';
  /** Schema version at save time. Equal to LESSON_DOC_VERSION when fresh. */
  version: number;
  attrs?: { sourceLocale?: string };
  content: BlockNode[];
}
