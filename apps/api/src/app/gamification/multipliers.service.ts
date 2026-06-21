import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type MultiplierKind, type MultiplierTarget } from '@prisma/client';
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

function toResponse(m: {
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
}) {
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
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * Admin management of Multiplier rows — premium default, course/lesson
 * promos, streak tiers, and campaigns. The resolver (@codify/domain) reads
 * the active rows at reward time, so edits here take effect immediately.
 */
@Injectable()
export class MultipliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.multiplier.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }] });
    return rows.map(toResponse);
  }

  async create(input: MultiplierInput) {
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

  async update(id: string, patch: Partial<MultiplierInput>) {
    const target = await this.prisma.multiplier.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Multiplier not found');
    const updated = await this.prisma.multiplier.update({
      where: { id },
      data: {
        kind: patch.kind,
        target: patch.target,
        value: patch.value !== undefined ? new Prisma.Decimal(patch.value) : undefined,
        startsAt: patch.startsAt === undefined ? undefined : patch.startsAt ? new Date(patch.startsAt) : null,
        endsAt: patch.endsAt === undefined ? undefined : patch.endsAt ? new Date(patch.endsAt) : null,
        courseId: patch.courseId,
        lessonId: patch.lessonId,
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
}
