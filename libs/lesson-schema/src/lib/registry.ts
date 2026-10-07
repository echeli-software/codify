/**
 * Block registry: per-block metadata (display name, icon hint, nesting,
 * interactivity). Drives the slash/insert menu, the editor's content
 * expressions and the renderer; a spec test asserts `allowedIn` agrees with
 * `lessonDocSchema` so the two never drift.
 */

import type { BlockType } from './types.js';
import type { BlockParent } from './walk.js';

export type BlockGroup = 'text' | 'structure' | 'media' | 'interactive';

export interface BlockRegistryEntry {
  type: BlockType;
  label: string;
  description: string;
  /**
   * Phosphor icon export name without the `phosphor` prefix
   * (e.g. `TextHTwo` → `phosphorTextHTwo`). Unique per insertable block.
   */
  icon: string;
  group: BlockGroup;
  /** Shipped in the editor surface. False for blocks that land later. */
  enabled: boolean;
  /** Offered in the insert / slash menu (structural children are not). */
  insertable: boolean;
  /** Containers this block may sit in directly (`doc` = the root). */
  allowedIn: readonly BlockParent[];
  /** Needs runtime interaction in the renderer (quiz, runners). */
  hasInteractive: boolean;
  /** LessonDoc version that introduced the block's current shape. */
  version: number;
  /** Extra search terms for the slash menu. */
  keywords?: readonly string[];
}

/** Containers that accept "nestable" blocks. */
export const NESTABLE_PARENTS: readonly BlockParent[] = [
  'doc',
  'listItem',
  'blockquote',
  'callout',
  'tableHeader',
  'tableCell',
];
const ROOT_ONLY: readonly BlockParent[] = ['doc'];

export const LESSON_BLOCK_REGISTRY: readonly BlockRegistryEntry[] = [
  {
    type: 'paragraph',
    label: 'Text',
    description: 'Plain paragraph.',
    icon: 'Paragraph',
    group: 'text',
    enabled: true,
    insertable: true,
    allowedIn: NESTABLE_PARENTS,
    hasInteractive: false,
    version: 1,
    keywords: ['paragraph', 'text', 'p'],
  },
  {
    type: 'heading',
    label: 'Heading',
    description: 'Section heading (H2 or H3).',
    icon: 'TextHTwo',
    group: 'text',
    enabled: true,
    insertable: true,
    allowedIn: NESTABLE_PARENTS,
    hasInteractive: false,
    version: 1,
    keywords: ['h2', 'h3', 'title', 'section'],
  },
  {
    type: 'bulletList',
    label: 'Bulleted list',
    description: 'Unordered list of items.',
    icon: 'ListBullets',
    group: 'structure',
    enabled: true,
    insertable: true,
    allowedIn: NESTABLE_PARENTS,
    hasInteractive: false,
    version: 1,
    keywords: ['ul', 'bullet', 'list'],
  },
  {
    type: 'orderedList',
    label: 'Numbered list',
    description: 'Ordered list of items.',
    icon: 'ListNumbers',
    group: 'structure',
    enabled: true,
    insertable: true,
    allowedIn: NESTABLE_PARENTS,
    hasInteractive: false,
    version: 1,
    keywords: ['ol', 'number', 'list'],
  },
  {
    type: 'listItem',
    label: 'List item',
    description: 'One entry of a list.',
    icon: 'DotOutline',
    group: 'structure',
    enabled: true,
    insertable: false,
    allowedIn: ['bulletList', 'orderedList'],
    hasInteractive: false,
    version: 1,
  },
  {
    type: 'blockquote',
    label: 'Quote',
    description: 'Highlighted quotation.',
    icon: 'Quotes',
    group: 'text',
    enabled: true,
    insertable: true,
    allowedIn: NESTABLE_PARENTS,
    hasInteractive: false,
    version: 1,
    keywords: ['quote', 'blockquote'],
  },
  {
    type: 'codeBlock',
    label: 'Code block',
    description: 'Multiline code with syntax language.',
    icon: 'CodeBlock',
    group: 'text',
    enabled: true,
    insertable: true,
    allowedIn: NESTABLE_PARENTS,
    hasInteractive: false,
    version: 1,
    keywords: ['code', 'pre', 'snippet'],
  },
  {
    type: 'callout',
    label: 'Callout',
    description: 'Boxed note: info, tip, warning, danger, success.',
    icon: 'Info',
    group: 'structure',
    enabled: true,
    insertable: true,
    allowedIn: ROOT_ONLY,
    hasInteractive: false,
    version: 1,
    keywords: ['note', 'tip', 'warning', 'info', 'alert'],
  },
  {
    type: 'horizontalRule',
    label: 'Divider',
    description: 'Visual horizontal divider.',
    icon: 'Minus',
    group: 'structure',
    enabled: true,
    insertable: true,
    allowedIn: NESTABLE_PARENTS,
    hasInteractive: false,
    version: 1,
    keywords: ['hr', 'divider', 'separator', 'rule'],
  },
  {
    type: 'image',
    label: 'Image',
    description: 'Uploaded image with alt text and caption.',
    icon: 'Image',
    group: 'media',
    enabled: true,
    insertable: true,
    allowedIn: NESTABLE_PARENTS,
    hasInteractive: false,
    version: 1,
    keywords: ['picture', 'photo', 'img', 'upload'],
  },
  {
    type: 'embed',
    label: 'Embed',
    description: 'YouTube, Vimeo, CodePen, CodeSandbox or Loom.',
    icon: 'FrameCorners',
    group: 'media',
    enabled: true,
    insertable: true,
    allowedIn: ROOT_ONLY,
    hasInteractive: false,
    version: 1,
    keywords: [
      'video',
      'youtube',
      'vimeo',
      'codepen',
      'codesandbox',
      'loom',
      'iframe',
    ],
  },
  {
    type: 'table',
    label: 'Table',
    description: 'Rows and columns with a header row.',
    icon: 'Table',
    group: 'structure',
    enabled: true,
    insertable: true,
    allowedIn: ROOT_ONLY,
    hasInteractive: false,
    version: 1,
    keywords: ['grid', 'rows', 'columns'],
  },
  {
    type: 'tableRow',
    label: 'Table row',
    description: 'A row of cells.',
    icon: 'Rows',
    group: 'structure',
    enabled: true,
    insertable: false,
    allowedIn: ['table'],
    hasInteractive: false,
    version: 1,
  },
  {
    type: 'tableHeader',
    label: 'Header cell',
    description: 'A header cell.',
    icon: 'Columns',
    group: 'structure',
    enabled: true,
    insertable: false,
    allowedIn: ['tableRow'],
    hasInteractive: false,
    version: 1,
  },
  {
    type: 'tableCell',
    label: 'Cell',
    description: 'A data cell.',
    icon: 'Square',
    group: 'structure',
    enabled: true,
    insertable: false,
    allowedIn: ['tableRow'],
    hasInteractive: false,
    version: 1,
  },
  {
    type: 'quiz',
    label: 'Quiz',
    description: 'Single- or multiple-choice question.',
    icon: 'ListChecks',
    group: 'interactive',
    enabled: true,
    insertable: true,
    allowedIn: ROOT_ONLY,
    hasInteractive: true,
    version: 1,
    keywords: ['question', 'multiple choice', 'test', 'check'],
  },
  {
    type: 'exerciseRef',
    label: 'Code exercise',
    description: 'Mounts an auto-graded coding exercise.',
    icon: 'Terminal',
    group: 'interactive',
    enabled: true,
    insertable: true,
    allowedIn: ROOT_ONLY,
    hasInteractive: true,
    version: 1,
    keywords: ['exercise', 'code', 'challenge'],
  },
  {
    type: 'aiPromptRef',
    label: 'AI prompt',
    description: 'Mounts a rubric-graded prompt task.',
    icon: 'Robot',
    group: 'interactive',
    enabled: true,
    insertable: true,
    allowedIn: ROOT_ONLY,
    hasInteractive: true,
    version: 1,
    keywords: ['ai', 'prompt', 'llm'],
  },
  {
    type: 'scenarioRef',
    label: 'Scenario',
    description: 'Mounts a branching dialogue scenario.',
    icon: 'TreeStructure',
    group: 'interactive',
    enabled: true,
    insertable: true,
    allowedIn: ROOT_ONLY,
    hasInteractive: true,
    version: 1,
    keywords: ['scenario', 'dialogue', 'branching'],
  },
];

export function enabledBlocks(): BlockRegistryEntry[] {
  return LESSON_BLOCK_REGISTRY.filter((b) => b.enabled);
}

/** Blocks the insert / slash menu offers. */
export function insertableBlocks(): BlockRegistryEntry[] {
  return LESSON_BLOCK_REGISTRY.filter((b) => b.enabled && b.insertable);
}

export function blockEntry(type: string): BlockRegistryEntry | undefined {
  return LESSON_BLOCK_REGISTRY.find((b) => b.type === type);
}

/** Whether `child` may sit directly inside `parent` per the registry. */
export function isAllowedIn(child: string, parent: BlockParent): boolean {
  return blockEntry(child)?.allowedIn.includes(parent) ?? false;
}
