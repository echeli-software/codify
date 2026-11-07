import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Category } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CategoryListResponse,
  CategoryResponse,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './categories.dto.js';

/**
 * Read paths are open to any authenticated role. Mutations are gated to
 * ADMIN at the controller layer — the service stays unaware of the actor
 * so it stays unit-testable without a request context.
 *
 * Soft-delete: rows set `deletedAt` and disappear from list/detail. The
 * @@unique([slug]) constraint includes deleted rows, so resurrecting a
 * slug requires either a new slug or hard-deletion via SQL (rare).
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: {
    skip: number;
    take: number;
  }): Promise<CategoryListResponse> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        skip: opts.skip,
        take: opts.take,
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.category.count({ where: { deletedAt: null } }),
    ]);
    return { items: items.map(toResponse), total };
  }

  async getById(id: string): Promise<CategoryResponse> {
    const cat = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    if (!cat) throw new NotFoundException('Category not found');
    return toResponse(cat);
  }

  async create(input: CreateCategoryDto): Promise<CategoryResponse> {
    const existing = await this.prisma.category.findUnique({
      where: { slug: input.slug },
    });
    if (existing) throw new ConflictException('Slug already in use');
    const created = await this.prisma.category.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        iconName: input.iconName ?? null,
        colorToken: input.colorToken ?? null,
      },
    });
    return toResponse(created);
  }

  async update(
    id: string,
    patch: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    const target = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) throw new NotFoundException('Category not found');
    if (patch.slug && patch.slug !== target.slug) {
      const dupe = await this.prisma.category.findUnique({
        where: { slug: patch.slug },
      });
      if (dupe) throw new ConflictException('Slug already in use');
    }
    // Category name/description are the source-locale text; translations of
    // a field that actually changed become outdated (docs/11 workspace).
    const changed = (['name', 'description'] as const).filter(
      (f) => patch[f] !== undefined && patch[f] !== target[f],
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.category.update({
        where: { id },
        data: { ...patch },
      });
      if (changed.length > 0) {
        await tx.contentTranslation.updateMany({
          where: {
            entityType: 'CATEGORY',
            entityId: id,
            field: { in: [...changed] },
          },
          data: { outdated: true },
        });
      }
      return row;
    });
    return toResponse(updated);
  }

  async softDelete(id: string): Promise<void> {
    const target = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) throw new NotFoundException('Category not found');
    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

function toResponse(c: Category): CategoryResponse {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    iconName: c.iconName,
    colorToken: c.colorToken,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
