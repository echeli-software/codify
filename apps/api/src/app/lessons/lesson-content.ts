/**
 * Lesson-body checks shared by the lesson endpoints and the translation
 * workspace: media-library references (docs/06 §6) and translated bodies
 * (docs/11 §3, docs/14 §3 — validated + structure-locked to the source).
 */

import {
  LessonDocMigrationError,
  lessonStructureIssues,
  migrateLessonDoc,
  validateLessonDoc,
  walkBlocks,
  type ImageNode,
  type LessonDoc,
  type LessonDocIssue,
} from '@codify/lesson-schema';

interface AssetLookup {
  asset: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; kind: true; confirmed: true; mimeType: true };
    }): Promise<
      { id: string; kind: string; confirmed: boolean; mimeType: string }[]
    >;
  };
}

/**
 * `image.assetId` must name an existing, upload-confirmed IMAGE asset. One
 * issue per offending block, pointing at its `attrs.assetId`.
 */
export async function imageAssetIssues(
  prisma: AssetLookup,
  doc: Pick<LessonDoc, 'content'>,
): Promise<LessonDocIssue[]> {
  const uses: { id: string; path: string }[] = [];
  walkBlocks(doc, (node, _parent, path) => {
    const id = node.type === 'image' ? (node as ImageNode).attrs.assetId : null;
    if (id)
      uses.push({
        id,
        path: `${path.map((i) => `content.${i}`).join('.')}.attrs.assetId`,
      });
  });
  if (uses.length === 0) return [];
  const rows = await prisma.asset.findMany({
    where: { id: { in: [...new Set(uses.map((u) => u.id))] } },
    select: { id: true, kind: true, confirmed: true, mimeType: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const issues: LessonDocIssue[] = [];
  for (const u of uses) {
    const a = byId.get(u.id);
    if (!a)
      issues.push({
        path: u.path,
        code: 'unknown_reference',
        message: `Unknown asset "${u.id}"`,
      });
    else if (a.kind !== 'IMAGE' || !a.mimeType.startsWith('image/'))
      issues.push({
        path: u.path,
        code: 'invalid_reference',
        message: `Asset "${u.id}" is not an image`,
      });
    else if (!a.confirmed)
      issues.push({
        path: u.path,
        code: 'invalid_reference',
        message: `Asset "${u.id}" upload was never confirmed`,
      });
  }
  return issues;
}

export type TranslatedBodyResult =
  | { ok: true; doc: LessonDoc }
  | { ok: false; issues: LessonDocIssue[] };

/**
 * Parse + migrate + validate a translated lesson body (the JSON string a
 * `ContentTranslation(LESSON, id, locale, 'contentJson')` row stores) and
 * require the same block structure as `source` (lessonStructureIssues).
 * Returns the whitelisted doc or every problem found.
 */
export function checkTranslatedBody(
  source: unknown,
  value: string,
): TranslatedBodyResult {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return {
      ok: false,
      issues: [{ path: '', code: 'invalid_json', message: 'Not valid JSON' }],
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [
        { path: '', code: 'invalid_type', message: 'Must be a LessonDoc' },
      ],
    };
  }
  let migrated: LessonDoc;
  try {
    migrated = migrateLessonDoc(raw as LessonDoc);
  } catch (err) {
    if (err instanceof LessonDocMigrationError)
      return {
        ok: false,
        issues: err.issues.length
          ? err.issues
          : [{ path: 'version', code: 'custom', message: err.message }],
      };
    throw err;
  }
  const result = validateLessonDoc(migrated);
  if (!result.ok) return result;
  let sourceDoc: unknown = source;
  try {
    sourceDoc = migrateLessonDoc(source as LessonDoc, { validate: null });
  } catch {
    /* compare against the stored shape */
  }
  const structure = lessonStructureIssues(sourceDoc, result.doc);
  if (structure.length) return { ok: false, issues: structure };
  return { ok: true, doc: result.doc as unknown as LessonDoc };
}
