/**
 * Block registry: per-block metadata (display name, icon hint, what kinds
 * of children it allows). Drives the slash-command menu and the floating
 * block-insertion UI.
 */

export interface BlockRegistryEntry {
  type: string;
  label: string;
  description: string;
  /** Phosphor icon name (must exist in ui-bootstrap's curated set). */
  icon: string;
  /** Currently in the v1 editor surface. False for blocks shipped later. */
  enabled: boolean;
}

export const LESSON_BLOCK_REGISTRY: BlockRegistryEntry[] = [
  {
    type: 'heading',
    label: 'Heading',
    description: 'Section heading (H2 or H3).',
    icon: 'pencil',
    enabled: true,
  },
  {
    type: 'bulletList',
    label: 'Bulleted list',
    description: 'Unordered list of items.',
    icon: 'menu',
    enabled: true,
  },
  {
    type: 'orderedList',
    label: 'Numbered list',
    description: 'Ordered list of items.',
    icon: 'menu',
    enabled: true,
  },
  {
    type: 'blockquote',
    label: 'Quote',
    description: 'Highlighted quotation.',
    icon: 'pencil',
    enabled: true,
  },
  {
    type: 'codeBlock',
    label: 'Code block',
    description: 'Multiline code with syntax language.',
    icon: 'pencil',
    enabled: true,
  },
  {
    type: 'callout',
    label: 'Callout',
    description: 'Boxed note: info, tip, warning, danger, success.',
    icon: 'info',
    enabled: true,
  },
  {
    type: 'horizontalRule',
    label: 'Divider',
    description: 'Visual horizontal divider.',
    icon: 'menu',
    enabled: true,
  },
  // ─── Coming in later phases ─────────────────────────────────────────────
  { type: 'image', label: 'Image', description: 'Inline image with caption.', icon: 'eye', enabled: false },
  { type: 'embed', label: 'Embed', description: 'YouTube / CodePen / etc.', icon: 'eye', enabled: false },
  { type: 'quiz', label: 'Quiz', description: 'Single/multi/match/order question.', icon: 'check-circle', enabled: false },
  { type: 'exerciseRef', label: 'Code exercise', description: 'Auto-graded coding exercise.', icon: 'pencil', enabled: false },
  { type: 'aiPrompt', label: 'AI prompt', description: 'Rubric-graded prompt task.', icon: 'pencil', enabled: false },
  { type: 'scenario', label: 'Scenario', description: 'Branching dialogue.', icon: 'pencil', enabled: false },
];

export function enabledBlocks(): BlockRegistryEntry[] {
  return LESSON_BLOCK_REGISTRY.filter((b) => b.enabled);
}
