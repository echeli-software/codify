// Public surface of @codify/lesson-schema. See docs/06-content-authoring.md.

export {
  LESSON_DOC_VERSION,
  type CalloutKind,
  type LessonDoc,
  type BlockNode,
  type ParagraphNode,
  type HeadingNode,
  type BulletListNode,
  type OrderedListNode,
  type ListItemNode,
  type BlockquoteNode,
  type CalloutNode,
  type CodeBlockNode,
  type DividerNode,
  type TextNode,
  type MarkType,
} from './lib/types.js';

export { lessonDocSchema, type LessonDocInput } from './lib/schema.js';
export { migrateLessonDoc, registeredMigrationTargets } from './lib/migrate.js';
export {
  LESSON_BLOCK_REGISTRY,
  enabledBlocks,
  type BlockRegistryEntry,
} from './lib/registry.js';
export { emptyLessonDoc } from './lib/empty.js';
