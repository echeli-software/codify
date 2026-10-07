import type { CourseStatus, LessonType } from '@codify/api-client';
import type { BadgeVariant } from '@codify/ui-bootstrap';

/** Same pattern the API validates course/category/plan slugs with. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export const LESSON_TYPES: readonly LessonType[] = [
  'READING',
  'QUIZ',
  'EXERCISE',
  'AI_PROMPT',
  'SCENARIO',
  'CAPSTONE',
];

export function statusVariant(status: CourseStatus): BadgeVariant {
  if (status === 'PUBLISHED') return 'success';
  if (status === 'DRAFT') return 'warning';
  return 'neutral';
}

/** Which companion editor (if any) a lesson type uses. */
export function lessonCompanion(
  type: LessonType,
): 'exercise' | 'ai-prompt' | 'scenario' | null {
  switch (type) {
    case 'EXERCISE':
      return 'exercise';
    case 'AI_PROMPT':
    case 'CAPSTONE':
      return 'ai-prompt';
    case 'SCENARIO':
      return 'scenario';
    default:
      return null;
  }
}

/** Parse a numeric form value; `null` when empty or not a finite number. */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `datetime-local` value (local wall time) → ISO string, or null. */
export function localToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO string → `datetime-local` value in local wall time, or null. */
export function isoToLocal(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
