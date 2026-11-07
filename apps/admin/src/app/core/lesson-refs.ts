import type { LessonType } from '@codify/api-client';
import type { BlockNode, LessonDoc } from '@codify/lesson-schema';

/** The three interactive blocks a lesson doc can point at. */
export type RefKind = 'exercise' | 'aiPrompt' | 'scenario';

export const REF_KINDS: readonly RefKind[] = [
  'exercise',
  'aiPrompt',
  'scenario',
];

const REF_BLOCK = {
  exercise: { type: 'exerciseRef', attr: 'exerciseId' },
  aiPrompt: { type: 'aiPromptRef', attr: 'aiPromptId' },
  scenario: { type: 'scenarioRef', attr: 'scenarioId' },
} as const;

/** A ref block found at the root of a lesson doc. */
export interface DocRef {
  /** Index in `doc.content`. */
  index: number;
  kind: RefKind;
  id: string;
}

/** Something a ref block can point at (resolved from the course's lessons). */
export interface RefCandidate {
  kind: RefKind;
  id: string;
  lessonId: string;
  lessonTitle: string;
}

function kindOfBlock(block: { type: string }): RefKind | null {
  for (const k of REF_KINDS) if (REF_BLOCK[k].type === block.type) return k;
  return null;
}

/** Ref blocks (root-only per the schema) in document order. */
export function docRefs(doc: LessonDoc | null | undefined): DocRef[] {
  const out: DocRef[] = [];
  (doc?.content ?? []).forEach((block, index) => {
    const kind = kindOfBlock(block);
    if (!kind) return;
    const attrs = (block as { attrs?: Record<string, unknown> }).attrs ?? {};
    out.push({ index, kind, id: String(attrs[REF_BLOCK[kind].attr] ?? '') });
  });
  return out;
}

/** Point the ref block at `index` to `id` (returns a new doc). */
export function setDocRef(
  doc: LessonDoc,
  index: number,
  id: string,
): LessonDoc {
  const block = doc.content[index];
  const kind = block ? kindOfBlock(block) : null;
  if (!kind) return doc;
  const content = doc.content.slice();
  content[index] = {
    type: REF_BLOCK[kind].type,
    attrs: { [REF_BLOCK[kind].attr]: id },
  } as BlockNode;
  return { ...doc, content };
}

/** Append a new ref block pointing at `id` (returns a new doc). */
export function appendDocRef(
  doc: LessonDoc,
  kind: RefKind,
  id: string,
): LessonDoc {
  const block = {
    type: REF_BLOCK[kind].type,
    attrs: { [REF_BLOCK[kind].attr]: id },
  } as BlockNode;
  return { ...doc, content: [...doc.content, block] };
}

/** Which ref kind a lesson of this type provides, if any. */
export function refKindForLessonType(type: LessonType): RefKind | null {
  switch (type) {
    case 'EXERCISE':
      return 'exercise';
    case 'AI_PROMPT':
    case 'CAPSTONE':
      return 'aiPrompt';
    case 'SCENARIO':
      return 'scenario';
    default:
      return null;
  }
}
