import { LESSON_DOC_VERSION, type LessonDoc } from './types.js';

/** Convenience: a fresh empty doc the editor can start from. */
export function emptyLessonDoc(sourceLocale = 'pt-BR'): LessonDoc {
  return {
    type: 'doc',
    version: LESSON_DOC_VERSION,
    attrs: { sourceLocale },
    content: [{ type: 'paragraph' }],
  };
}
