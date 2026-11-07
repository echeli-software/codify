import { DestroyRef, inject } from '@angular/core';
import { FormControl } from '@angular/forms';
import { emptyLessonDoc, type LessonDoc } from '@codify/lesson-schema';

/** How long after (re)loading a doc editor emissions count as normalisation. */
export const EDITOR_SETTLE_MS = 1000;

/**
 * Binds a LessonBlockEditor through a FormControl so the doc is written
 * synchronously before Tiptap mounts (with `ngModel` the first write is
 * deferred and the editor can emit its empty initial doc first).
 * Emissions within EDITOR_SETTLE_MS of `reset()` are the editor
 * normalising the loaded doc, not author edits: they update the value
 * (`onSettle`) without counting as a change (`onEdit`).
 * Call from an injection context.
 */
export class EditorDocBinding {
  readonly control = new FormControl<LessonDoc>(emptyLessonDoc(), {
    nonNullable: true,
  });
  private resetAt = 0;

  constructor(
    onEdit: (doc: LessonDoc) => void,
    onSettle: (doc: LessonDoc) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {
    const sub = this.control.valueChanges.subscribe((doc) => {
      if (now() - this.resetAt < EDITOR_SETTLE_MS) onSettle(doc);
      else onEdit(doc);
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  /** Load a doc (e.g. from the API) — starts a new settle window. */
  reset(doc: LessonDoc): void {
    this.resetAt = this.now();
    this.control.setValue(doc, { emitEvent: false });
  }

  /** Programmatic change (ref picker etc.) — no settle window. */
  set(doc: LessonDoc): void {
    this.control.setValue(doc, { emitEvent: false });
  }
}
