import type { AnyBlockNode, LessonDoc } from './types.js';

/** Container a block sits in: the doc root or another block's type. */
export type BlockParent = 'doc' | AnyBlockNode['type'];

export type BlockVisitor = (
  node: AnyBlockNode,
  parent: BlockParent,
  path: number[],
) => void;

/** Depth-first walk over every block node (inline nodes are skipped). */
export function walkBlocks(
  doc: Pick<LessonDoc, 'content'>,
  visit: BlockVisitor,
): void {
  const step = (
    nodes: unknown[],
    parent: BlockParent,
    path: number[],
  ): void => {
    nodes.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return;
      const node = raw as AnyBlockNode & { content?: unknown[] };
      if (
        (node.type as string) === 'text' ||
        (node.type as string) === 'hardBreak'
      )
        return;
      const here = [...path, i];
      visit(node, parent, here);
      if (Array.isArray(node.content)) step(node.content, node.type, here);
    });
  };
  step(Array.isArray(doc.content) ? doc.content : [], 'doc', []);
}

export interface LessonDocRefs {
  exerciseIds: string[];
  aiPromptIds: string[];
  scenarioIds: string[];
  assetIds: string[];
  /** Image URLs (for offline prefetch — docs/16 §5). */
  imageSrcs: string[];
}

/** Every external reference a doc makes, de-duplicated, in document order. */
export function collectLessonRefs(
  doc: Pick<LessonDoc, 'content'>,
): LessonDocRefs {
  const out = {
    exerciseIds: new Set<string>(),
    aiPromptIds: new Set<string>(),
    scenarioIds: new Set<string>(),
    assetIds: new Set<string>(),
    imageSrcs: new Set<string>(),
  };
  walkBlocks(doc, (node) => {
    switch (node.type) {
      case 'exerciseRef':
        out.exerciseIds.add(node.attrs.exerciseId);
        break;
      case 'aiPromptRef':
        out.aiPromptIds.add(node.attrs.aiPromptId);
        break;
      case 'scenarioRef':
        out.scenarioIds.add(node.attrs.scenarioId);
        break;
      case 'image':
        if (node.attrs.assetId) out.assetIds.add(node.attrs.assetId);
        if (node.attrs.src) out.imageSrcs.add(node.attrs.src);
        break;
      default:
        break;
    }
  });
  return {
    exerciseIds: [...out.exerciseIds],
    aiPromptIds: [...out.aiPromptIds],
    scenarioIds: [...out.scenarioIds],
    assetIds: [...out.assetIds],
    imageSrcs: [...out.imageSrcs],
  };
}
