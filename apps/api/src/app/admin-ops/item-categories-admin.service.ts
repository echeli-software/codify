import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { ContentLocalizer } from '../translations/content-localizer.service.js';
import type {
  CreateItemCategoryAdminDto,
  ItemCategoryAdminView,
  UpdateItemCategoryAdminDto,
} from './admin-ops.dto.js';

type CategoryRow = {
  slug: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count: { items: number };
};

function toView(c: CategoryRow): ItemCategoryAdminView {
  return {
    slug: c.slug,
    name: c.name,
    sortOrder: c.sortOrder,
    itemCount: c._count.items,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const WITH_COUNT = { _count: { select: { items: true } } } as const;

/**
 * Shop → Item Categories (docs/04): slug, name, sortOrder. The slug is the
 * primary key items reference, so it can't change; a category still used
 * by any item (including soft-deleted ones — the FK remains) can't be
 * deleted. `name` is the pt-BR source; other locales are ITEM_CATEGORY
 * ContentTranslation rows keyed by slug (docs/11 §3) — renaming marks them
 * outdated.
 */
@Injectable()
export class ItemCategoriesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly localizer?: ContentLocalizer,
  ) {}

  async list(): Promise<ItemCategoryAdminView[]> {
    const rows = await this.prisma.itemCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: WITH_COUNT,
    });
    return rows.map(toView);
  }

  async create(
    input: CreateItemCategoryAdminDto,
  ): Promise<ItemCategoryAdminView> {
    try {
      const row = await this.prisma.itemCategory.create({
        data: {
          slug: input.slug,
          name: input.name.trim(),
          sortOrder: input.sortOrder ?? 0,
        },
        include: WITH_COUNT,
      });
      return toView(row);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException({
          code: 'conflict.unique',
          message: 'Category slug already in use',
        });
      throw err;
    }
  }

  async update(
    slug: string,
    patch: UpdateItemCategoryAdminDto,
  ): Promise<{ before: ItemCategoryAdminView; after: ItemCategoryAdminView }> {
    const before = await this.get(slug);
    const row = await this.prisma.itemCategory.update({
      where: { slug },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.sortOrder !== undefined
          ? { sortOrder: patch.sortOrder }
          : {}),
      },
      include: WITH_COUNT,
    });
    if (row.name !== before.name)
      await this.localizer?.markSourceChanged('ITEM_CATEGORY', slug, ['name']);
    return { before, after: toView(row) };
  }

  async remove(slug: string): Promise<ItemCategoryAdminView> {
    const before = await this.get(slug);
    const inUse = () =>
      new ConflictException({
        code: 'ITEM_CATEGORY_IN_USE',
        message: 'Items still use this category',
      });
    if (before.itemCount > 0) throw inUse();
    try {
      await this.prisma.itemCategory.delete({ where: { slug } });
    } catch (err) {
      // An item created meanwhile trips the FK (P2003).
      if ((err as { code?: string })?.code === 'P2003') throw inUse();
      throw err;
    }
    return before;
  }

  private async get(slug: string): Promise<ItemCategoryAdminView> {
    const row = await this.prisma.itemCategory.findUnique({
      where: { slug },
      include: WITH_COUNT,
    });
    if (!row) throw new NotFoundException('Item category not found');
    return toView(row);
  }
}
