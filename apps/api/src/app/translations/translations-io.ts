/**
 * Bulk translation export / import formats (docs/11 §3 "Bulk
 * import/export", docs/04 Translations):
 *
 *   CSV  — one row per (entity, field), header
 *          `entityId,locale,field,sourceValue,translatedValue`
 *          (RFC 4180 quoting, UTF-8, CRLF line ends).
 *   JSON — `{ entityType, locale, exportedAt, rows: [{ entityId, label,
 *          field, status, sourceValue, translatedValue }] }` for TMS tools.
 *
 * Pure parsing / serialising; the service validates rows against the
 * database.
 */

import type { TranslationWorkRow } from './translations.logic.js';

export const CSV_COLUMNS = [
  'entityId',
  'locale',
  'field',
  'sourceValue',
  'translatedValue',
] as const;

/** Rows a single import may carry. */
export const MAX_IMPORT_ROWS = 2000;

export type TranslationFileFormat = 'csv' | 'json';

export interface ImportRow {
  /** 1-based row number in the file (CSV: data rows start at 2). */
  row: number;
  entityId: string;
  locale: string;
  field: string;
  /** The source text the translator saw (informational; never written). */
  sourceValue: string | null;
  translatedValue: string;
}

export interface ImportRowError {
  row: number;
  entityId?: string;
  field?: string;
  message: string;
}

function csvCell(value: string | null | undefined): string {
  const v = value ?? '';
  // Neutralise spreadsheet formula injection for cells opened in Excel /
  // Sheets; the importer strips the guard again.
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(guarded) || guarded !== v
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** Work rows → CSV text (header + one line per row). */
export function toCsv(rows: readonly TranslationWorkRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [r.entityId, r.locale, r.field, r.sourceValue, r.value]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function toJsonExport(
  entityType: string,
  locale: string,
  rows: readonly TranslationWorkRow[],
  now = new Date(),
): string {
  return JSON.stringify(
    {
      entityType,
      locale,
      exportedAt: now.toISOString(),
      rows: rows.map((r) => ({
        entityId: r.entityId,
        label: r.label,
        field: r.field,
        status: r.status,
        sourceValue: r.sourceValue,
        translatedValue: r.value,
      })),
    },
    null,
    2,
  );
}

/** RFC 4180 parser (quoted cells may hold commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // BOM
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Unterminated quoted cell');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Undo `csvCell`'s formula guard. */
function unguard(v: string): string {
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

/**
 * Parse an import file into rows + structural errors (bad header, wrong
 * column count, missing ids). Value checks happen in the service.
 */
export function parseImportFile(
  format: TranslationFileFormat,
  content: string,
): { rows: ImportRow[]; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const rows: ImportRow[] = [];
  if (format === 'csv') {
    let table: string[][];
    try {
      table = parseCsv(content);
    } catch (err) {
      return { rows, errors: [{ row: 0, message: (err as Error).message }] };
    }
    const header = (table[0] ?? []).map((h) => h.trim());
    const idx = Object.fromEntries(
      CSV_COLUMNS.map((c) => [c, header.indexOf(c)]),
    ) as Record<(typeof CSV_COLUMNS)[number], number>;
    const missing = CSV_COLUMNS.filter(
      (c) => c !== 'sourceValue' && idx[c] < 0,
    );
    if (missing.length) {
      return {
        rows,
        errors: [{ row: 1, message: `Missing columns: ${missing.join(', ')}` }],
      };
    }
    table.slice(1).forEach((cells, i) => {
      const row = i + 2;
      if (cells.length !== header.length) {
        errors.push({
          row,
          message: `Expected ${header.length} columns, found ${cells.length}`,
        });
        return;
      }
      rows.push({
        row,
        entityId: cells[idx.entityId].trim(),
        locale: cells[idx.locale].trim(),
        field: cells[idx.field].trim(),
        sourceValue:
          idx.sourceValue >= 0 ? unguard(cells[idx.sourceValue]) : null,
        translatedValue: unguard(cells[idx.translatedValue]),
      });
    });
  } else {
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      return { rows, errors: [{ row: 0, message: 'Not valid JSON' }] };
    }
    const list = Array.isArray(json)
      ? json
      : (json as { rows?: unknown } | null)?.rows;
    const fileLocale =
      !Array.isArray(json) &&
      typeof (json as { locale?: unknown })?.locale === 'string'
        ? (json as { locale: string }).locale
        : null;
    if (!Array.isArray(list)) {
      return { rows, errors: [{ row: 0, message: 'Expected a "rows" array' }] };
    }
    list.forEach((raw, i) => {
      const row = i + 1;
      const r = raw as Record<string, unknown> | null;
      const s = (k: string) =>
        r && typeof r[k] === 'string' ? (r[k] as string) : null;
      const entityId = s('entityId');
      const field = s('field');
      const translatedValue =
        r &&
        (r['translatedValue'] === null || r['translatedValue'] === undefined)
          ? ''
          : s('translatedValue');
      if (!entityId || !field || translatedValue === null) {
        errors.push({
          row,
          message: 'Each row needs string entityId, field and translatedValue',
        });
        return;
      }
      rows.push({
        row,
        entityId: entityId.trim(),
        locale: (s('locale') ?? fileLocale ?? '').trim(),
        field: field.trim(),
        sourceValue: s('sourceValue'),
        translatedValue,
      });
    });
  }
  if (rows.length > MAX_IMPORT_ROWS)
    errors.push({
      row: 0,
      message: `At most ${MAX_IMPORT_ROWS} rows per import`,
    });
  return { rows, errors };
}
