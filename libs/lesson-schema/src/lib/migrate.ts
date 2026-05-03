/**
 * Versioned migrations between LessonDoc schema revisions. Bumping
 * LESSON_DOC_VERSION requires registering a migration here; CI lints for it.
 *
 * Each migration receives the doc one version below the target and returns a
 * doc at the target version. Migrations run in sequence: v1 → v2 → v3 …
 */

import { LESSON_DOC_VERSION, type LessonDoc } from './types.js';

type MigrationFn = (doc: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

const MIGRATIONS: Record<number, MigrationFn> = {
  // Future entries:
  //   2: (doc) => { ... v1 → v2 transformation ... },
  //   3: (doc) => { ... v2 → v3 transformation ... },
};

/**
 * Run any registered migrations needed to bring `doc.version` up to
 * LESSON_DOC_VERSION. Pure — does not mutate the input.
 */
export function migrateLessonDoc(doc: { version?: number; [k: string]: unknown }): LessonDoc {
  let current = JSON.parse(JSON.stringify(doc)) as { version?: number; [k: string]: unknown };
  let version = current.version ?? 1;

  if (version > LESSON_DOC_VERSION) {
    throw new Error(
      `LessonDoc version ${version} is newer than supported (${LESSON_DOC_VERSION}). ` +
        `Upgrade your client.`,
    );
  }

  while (version < LESSON_DOC_VERSION) {
    const next = version + 1;
    const fn = MIGRATIONS[next];
    if (!fn) {
      throw new Error(
        `No migration registered for LessonDoc v${version} → v${next}. ` +
          `Add one in libs/lesson-schema/src/lib/migrate.ts.`,
      );
    }
    current = fn(current);
    current.version = next;
    version = next;
  }

  current.version = LESSON_DOC_VERSION;
  return current as unknown as LessonDoc;
}

/**
 * Test helper: return the list of registered target versions.
 */
export function registeredMigrationTargets(): number[] {
  return Object.keys(MIGRATIONS).map(Number).sort((a, b) => a - b);
}
