/**
 * Versioned migrations between LessonDoc schema revisions. Bumping
 * LESSON_DOC_VERSION requires registering a migration here; the spec test
 * "has a migration for every version" fails otherwise.
 *
 * Each migration receives the doc one version below the target and returns a
 * doc at the target version. Migrations run in sequence: v1 → v2 → v3 …, and
 * the result of every step is validated (by default against
 * `lessonDocSchema`), so a broken migration fails at the step that broke it.
 */

import { LESSON_DOC_VERSION, type LessonDoc } from './types.js';
import {
  formatLessonDocIssues,
  lessonDocSchema,
  type LessonDocIssue,
} from './schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MigrationFn = (doc: any) => any;
export type MigrationMap = Readonly<Record<number, MigrationFn>>;

/** Registered migrations, keyed by TARGET version. */
export const LESSON_DOC_MIGRATIONS: MigrationMap = {
  // Future entries:
  //   2: (doc) => { ... v1 → v2 transformation ... },
};

/** Validator run after each migration step; throw to abort. */
export type MigrationValidator = (doc: unknown, version: number) => void;

export class LessonDocMigrationError extends Error {
  constructor(
    message: string,
    readonly version: number,
    readonly issues: LessonDocIssue[] = [],
  ) {
    super(message);
    this.name = 'LessonDocMigrationError';
  }
}

const defaultValidator: MigrationValidator = (doc, version) => {
  const parsed = lessonDocSchema.safeParse(doc);
  if (!parsed.success) {
    throw new LessonDocMigrationError(
      `LessonDoc failed validation after migrating to v${version}`,
      version,
      formatLessonDocIssues(parsed.error),
    );
  }
};

export interface MigrateLessonDocOptions {
  /** Migration map (default: LESSON_DOC_MIGRATIONS). Injectable for tests. */
  migrations?: MigrationMap;
  /** Version to migrate up to (default: LESSON_DOC_VERSION). */
  targetVersion?: number;
  /** Per-step validator (default: lessonDocSchema). Pass `null` to skip. */
  validate?: MigrationValidator | null;
}

/**
 * Run any registered migrations needed to bring `doc.version` up to the
 * target version. Pure — does not mutate the input. A doc already at the
 * target version is returned as a copy without validation (callers that
 * persist validate separately, so they can surface every issue).
 */
export function migrateLessonDoc(
  doc: LessonDoc | { version?: number; [k: string]: unknown },
  options: MigrateLessonDocOptions = {},
): LessonDoc {
  const migrations = options.migrations ?? LESSON_DOC_MIGRATIONS;
  const target = options.targetVersion ?? LESSON_DOC_VERSION;
  const validate =
    options.validate === undefined ? defaultValidator : options.validate;

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new LessonDocMigrationError('LessonDoc must be an object', 0);
  }
  let current = JSON.parse(JSON.stringify(doc)) as {
    version?: number;
    [k: string]: unknown;
  };
  let version =
    typeof current.version === 'number' && Number.isInteger(current.version)
      ? current.version
      : 1;

  if (version > target) {
    throw new LessonDocMigrationError(
      `LessonDoc version ${version} is newer than supported (${target}). ` +
        `Upgrade your client.`,
      version,
    );
  }

  while (version < target) {
    const next = version + 1;
    const fn = migrations[next];
    if (!fn) {
      throw new LessonDocMigrationError(
        `No migration registered for LessonDoc v${version} → v${next}. ` +
          `Add one in libs/lesson-schema/src/lib/migrate.ts.`,
        version,
      );
    }
    current = fn(JSON.parse(JSON.stringify(current)));
    current.version = next;
    validate?.(current, next);
    version = next;
  }

  current.version = target;
  return current as unknown as LessonDoc;
}

/** Registered target versions, ascending (default: the module map). */
export function registeredMigrationTargets(
  migrations: MigrationMap = LESSON_DOC_MIGRATIONS,
): number[] {
  return Object.keys(migrations)
    .map(Number)
    .sort((a, b) => a - b);
}
