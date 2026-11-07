import { TestBed } from '@angular/core/testing';
import { emptyLessonDoc, type LessonDoc } from '@codify/lesson-schema';
import { EDITOR_SETTLE_MS, EditorDocBinding } from './editor-doc';

const doc = (text: string): LessonDoc => ({
  ...emptyLessonDoc(),
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('EditorDocBinding', () => {
  it('treats emissions right after reset as normalisation, later ones as edits', () => {
    let t = 1_000;
    const edits: LessonDoc[] = [];
    const settles: LessonDoc[] = [];
    const b = TestBed.runInInjectionContext(
      () =>
        new EditorDocBinding(
          (d) => edits.push(d),
          (d) => settles.push(d),
          () => t,
        ),
    );
    b.reset(doc('loaded'));
    expect(b.control.value).toEqual(doc('loaded'));
    b.control.setValue(doc('normalised')); // editor mount emission
    expect(settles).toHaveLength(1);
    expect(edits).toHaveLength(0);
    t += EDITOR_SETTLE_MS + 1;
    b.control.setValue(doc('typed'));
    expect(edits).toEqual([doc('typed')]);
    b.set(doc('programmatic')); // no emission
    expect(edits).toHaveLength(1);
  });
});
