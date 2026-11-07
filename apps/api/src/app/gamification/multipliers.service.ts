import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type MultiplierKind,
  type MultiplierTarget,
} from '@prisma/client';
import { isMultiplierActiveAt, validateMultiplierDraft } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';

export interface MultiplierInput {
  kind: MultiplierKind;
  target?: MultiplierTarget;
  value: number;
  startsAt?: string | null;
  endsAt?: string | null;
  courseId?: string | null;
  lessonId?: string | null;
  streakDaysMin?: number | null;
  description?: string | null;
  isActive?: boolean;
}

export interface MultiplierResponse {
  id: string;
  kind: MultiplierKind;
  target: MultiplierTarget;
  value: number;
  startsAt: string | null;
  endsAt: string | null;
  courseId: string | null;
  lessonId: string | null;
  streakDaysMin: number | null;
  description: string | null;
  isActive: boolean;
  /** Enabled and inside its time window right now. */
  activeNow: boolean;
  createdAt: string;
  updatedAt: string;
}

type MultiplierRow = {
  id: string;
  kind: MultiplierKind;
  target: MultiplierTarget;
  value: Prisma.Decimal;
  startsAt: Date | null;
  endsAt: Date | null;
  courseId: string | null;
  lessonId: string | null;
  streakDaysMin: number | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(m: MultiplierRow, now = new Date()): MultiplierResponse {
  return {
    id: m.id,
    kind: m.kind,
    target: m.target,
    value: Number(m.value),
    startsAt: m.startsAt?.toISOString() ?? null,
    endsAt: m.endsAt?.toISOString() ?? null,
    courseId: m.courseId,
    lessonId: m.lessonId,
    streakDaysMin: m.streakDaysMin,
    description: m.description,
    isActive: m.isActive,
    activeNow: m.isActive && isMultiplierActiveAt(m, now),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/** `undefined` keeps the stored value, `null`/'' clears it. */
function dateField(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

/**
 * Admin management of Multiplier rows — premium default, course/lesson
 * promos, streak tiers, and campaigns. The resolver (@codify/domain) reads
 * the active rows at reward time, so edits here take effect immediately.
 */
@Injectable()
export class MultipliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    opts: { active?: 'now'; kind?: MultiplierKind } = {},
  ): Promise<MultiplierResponse[]> {
    const now = new Date();
    const where: Prisma.MultiplierWhereInput = {};
    if (opts.kind) where.kind = opts.kind;
    if (opts.active === 'now') {
      where.isActive = true;
      where.AND = [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ];
    }
    const rows = await this.prisma.multiplier.findMany({
      where,
      orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => toResponse(r, now));
  }

  async create(input: MultiplierInput): Promise<MultiplierResponse> {
    this.assertValid(input);
    const created = await this.prisma.multiplier.create({
      data: {
        kind: input.kind,
        target: input.target ?? 'BOTH',
        value: new Prisma.Decimal(input.value),
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        courseId: input.courseId ?? null,
        lessonId: input.lessonId ?? null,
        streakDaysMin: input.streakDaysMin ?? null,
        description: input.description ?? null,
        isActive: input.isActive ?? true,
      },
    });
    return toResponse(created);
  }

  async update(
    id: string,
    patch: Partial<MultiplierInput>,
  ): Promise<MultiplierResponse> {
    const current = await this.prisma.multiplier.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Multiplier not found');

    const startsAt = dateField(patch.startsAt);
    const endsAt = dateField(patch.endsAt);
    // Validate the row as it will look after the patch.
    this.assertValid({
      kind: patch.kind ?? current.kind,
      target: patch.target ?? current.target,
      value: patch.value ?? Number(current.value),
      startsAt: startsAt === undefined ? current.startsAt : startsAt,
      endsAt: endsAt === undefined ? current.endsAt : endsAt,
      courseId:
        patch.courseId === undefined ? current.courseId : patch.courseId,
      lessonId:
        patch.lessonId === undefined ? current.lessonId : patch.lessonId,
      streakDaysMin:
        patch.streakDaysMin === undefined
          ? current.streakDaysMin
          : patch.streakDaysMin,
    });

    const updated = await this.prisma.multiplier.update({
      where: { id },
      data: {
        kind: patch.kind,
        target: patch.target,
        value:
          patch.value !== undefined
            ? new Prisma.Decimal(patch.value)
            : undefined,
        startsAt,
        endsAt,
        courseId:
          patch.courseId === undefined ? undefined : patch.courseId || null,
        lessonId:
          patch.lessonId === undefined ? undefined : patch.lessonId || null,
        streakDaysMin: patch.streakDaysMin,
        description: patch.description,
        isActive: patch.isActive,
      },
    });
    return toResponse(updated);
  }

  async remove(id: string): Promise<void> {
    const target = await this.prisma.multiplier.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Multiplier not found');
    await this.prisma.multiplier.delete({ where: { id } });
  }

  private assertValid(draft: Parameters<typeof validateMultiplierDraft>[0]) {
    const errors = validateMultiplierDraft(draft);
    if (errors.length) throw new BadRequestException(errors);
  }
}
