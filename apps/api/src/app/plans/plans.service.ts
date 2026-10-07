import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Plan, PlanPrice, Prisma } from '@prisma/client';
import { planIncludesCourse } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import {
  BILLING_PROVIDER,
  type BillingProvider,
} from '../billing/billing.provider.js';
import type {
  CreatePlanDto,
  ListPlansQueryDto,
  PlanListResponse,
  PlanPriceInputDto,
  PlanPriceResponse,
  PlanResponse,
  UpdatePlanDto,
  UpdatePlanPriceDto,
} from './plans.dto.js';

type PlanWithRelations = Plan & {
  prices: PlanPrice[];
  categories: { categoryId: string }[];
};

const PLAN_INCLUDE = {
  prices: { orderBy: { amountCents: 'asc' } },
  categories: { select: { categoryId: true } },
} satisfies Prisma.PlanInclude;

/**
 * Plan / PlanPrice / PlanCategory management + "Sync to Stripe".
 *
 * Reads: active plans are visible to any authenticated user (the student
 * paywall lists them). `includeInactive` is honored only for staff and
 * gated at the controller. Writes: ADMIN only (gated at controller).
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
  ) {}

  async list(
    query: ListPlansQueryDto,
    opts: { includeInactive: boolean },
  ): Promise<PlanListResponse> {
    const where: Prisma.PlanWhereInput = opts.includeInactive
      ? {}
      : { isActive: true, deletedAt: null };

    let plans = await this.prisma.plan.findMany({
      where,
      include: PLAN_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // plans-including-this-course filter (course-detail chips / paywall).
    if (query.courseId) {
      const cats = await this.prisma.courseCategory.findMany({
        where: { courseId: query.courseId },
        select: { categoryId: true },
      });
      const courseCategoryIds = cats.map((c) => c.categoryId);
      plans = plans.filter((p) =>
        planIncludesCourse(
          {
            id: p.id,
            slug: p.slug,
            name: p.name,
            isAllAccess: p.isAllAccess,
            isActive: p.isActive,
            categoryIds: p.categories.map((c) => c.categoryId),
          },
          courseCategoryIds,
        ),
      );
    }

    const map = (p: PlanWithRelations) => toResponse(p, opts.includeInactive);
    return { items: plans.map(map), total: plans.length };
  }

  async getById(
    id: string,
    opts: { includeInactive: boolean },
  ): Promise<PlanResponse> {
    const plan = await this.prisma.plan.findFirst({
      where: opts.includeInactive
        ? { id }
        : { id, isActive: true, deletedAt: null },
      include: PLAN_INCLUDE,
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return toResponse(plan, opts.includeInactive);
  }

  async create(input: CreatePlanDto): Promise<PlanResponse> {
    const existing = await this.prisma.plan.findUnique({
      where: { slug: input.slug },
    });
    if (existing) throw new ConflictException('Slug already in use');
    assertNoDuplicatePrices(input.prices);

    const created = await this.withStoreProductConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const plan = await tx.plan.create({
          data: {
            slug: input.slug,
            name: input.name,
            description: input.description ?? null,
            tagline: input.tagline ?? null,
            isAllAccess: input.isAllAccess ?? false,
            revenueCatEntitlementId: input.revenueCatEntitlementId || null,
            trialDays: input.trialDays ?? 7,
            sortOrder: input.sortOrder ?? 0,
          },
        });
        if (input.categoryIds?.length) {
          await tx.planCategory.createMany({
            data: input.categoryIds.map((categoryId) => ({
              planId: plan.id,
              categoryId,
            })),
          });
        }
        if (input.prices?.length) {
          await tx.planPrice.createMany({
            data: input.prices.map((p) => ({
              planId: plan.id,
              currency: p.currency,
              amountCents: p.amountCents,
              period: p.period,
              maxInstallments: p.maxInstallments ?? null,
              storeProductId: p.storeProductId || null,
            })),
          });
        }
        return plan;
      }),
    );
    return this.getById(created.id, { includeInactive: true });
  }

  async update(id: string, patch: UpdatePlanDto): Promise<PlanResponse> {
    const target = await this.prisma.plan.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) throw new NotFoundException('Plan not found');
    if (patch.slug && patch.slug !== target.slug) {
      const dupe = await this.prisma.plan.findUnique({
        where: { slug: patch.slug },
      });
      if (dupe) throw new ConflictException('Slug already in use');
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.PlanUpdateInput = {};
      if (patch.slug !== undefined) data.slug = patch.slug;
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.description !== undefined) data.description = patch.description;
      if (patch.tagline !== undefined) data.tagline = patch.tagline;
      if (patch.isAllAccess !== undefined) data.isAllAccess = patch.isAllAccess;
      if (patch.revenueCatEntitlementId !== undefined)
        data.revenueCatEntitlementId = patch.revenueCatEntitlementId || null;
      if (patch.isActive !== undefined) data.isActive = patch.isActive;
      if (patch.trialDays !== undefined) data.trialDays = patch.trialDays;
      if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
      if (Object.keys(data).length)
        await tx.plan.update({ where: { id }, data });

      if (patch.categoryIds) {
        await tx.planCategory.deleteMany({ where: { planId: id } });
        if (patch.categoryIds.length) {
          await tx.planCategory.createMany({
            data: patch.categoryIds.map((categoryId) => ({
              planId: id,
              categoryId,
            })),
          });
        }
      }
    });
    return this.getById(id, { includeInactive: true });
  }

  async softDelete(id: string): Promise<void> {
    const target = await this.prisma.plan.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target) throw new NotFoundException('Plan not found');
    await this.prisma.plan.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async addPrice(
    planId: string,
    input: PlanPriceInputDto,
  ): Promise<PlanResponse> {
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const dupe = await this.prisma.planPrice.findUnique({
      where: {
        planId_currency_period: {
          planId,
          currency: input.currency,
          period: input.period,
        },
      },
    });
    if (dupe)
      throw new ConflictException(
        'A price for this currency + period already exists',
      );
    await this.withStoreProductConflict(() =>
      this.prisma.planPrice.create({
        data: {
          planId,
          currency: input.currency,
          amountCents: input.amountCents,
          period: input.period,
          maxInstallments: input.maxInstallments ?? null,
          storeProductId: input.storeProductId || null,
        },
      }),
    );
    return this.getById(planId, { includeInactive: true });
  }

  /** Patch a price's store product id / active flag / installments. */
  async updatePrice(
    planId: string,
    priceId: string,
    patch: UpdatePlanPriceDto,
  ): Promise<PlanResponse> {
    const price = await this.prisma.planPrice.findFirst({
      where: { id: priceId, planId, plan: { deletedAt: null } },
    });
    if (!price) throw new NotFoundException('Price not found');
    const data: Prisma.PlanPriceUpdateInput = {};
    if (patch.storeProductId !== undefined)
      data.storeProductId = patch.storeProductId || null;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.maxInstallments !== undefined)
      data.maxInstallments = patch.maxInstallments;
    if (Object.keys(data).length) {
      await this.withStoreProductConflict(() =>
        this.prisma.planPrice.update({ where: { id: priceId }, data }),
      );
    }
    return this.getById(planId, { includeInactive: true });
  }

  /** storeProductId is globally unique: map the P2002 to a 409. */
  private async withStoreProductConflict<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'That store product id is already used by another price',
        );
      }
      throw err;
    }
  }

  async removePrice(planId: string, priceId: string): Promise<PlanResponse> {
    const price = await this.prisma.planPrice.findFirst({
      where: { id: priceId, planId },
    });
    if (!price) throw new NotFoundException('Price not found');
    await this.prisma.planPrice.delete({ where: { id: priceId } });
    return this.getById(planId, { includeInactive: true });
  }

  /**
   * Create/refresh the Stripe Product + Prices for a plan via the billing
   * provider, then persist the returned ids. Idempotent: re-syncing keeps
   * existing ids. See /docs/09-billing.md §4.
   */
  async syncToStripe(id: string): Promise<PlanResponse> {
    const plan = await this.prisma.plan.findFirst({
      where: { id, deletedAt: null },
      include: PLAN_INCLUDE,
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.prices.length) {
      throw new BadRequestException(
        'Add at least one price before syncing to Stripe',
      );
    }

    const result = await this.billing.syncPlan({
      plan: {
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        description: plan.description,
        stripeProductId: plan.stripeProductId,
      },
      prices: plan.prices.map((p) => ({
        id: p.id,
        currency: p.currency,
        amountCents: p.amountCents,
        period: p.period,
        maxInstallments: p.maxInstallments,
        stripePriceId: p.stripePriceId,
        isActive: p.isActive,
      })),
    });

    await this.prisma.$transaction([
      this.prisma.plan.update({
        where: { id },
        data: { stripeProductId: result.stripeProductId },
      }),
      ...result.prices.map((p) =>
        this.prisma.planPrice.update({
          where: { id: p.id },
          data: { stripePriceId: p.stripePriceId },
        }),
      ),
    ]);
    return this.getById(id, { includeInactive: true });
  }
}

function assertNoDuplicatePrices(
  prices: PlanPriceInputDto[] | undefined,
): void {
  if (!prices?.length) return;
  const seen = new Set<string>();
  for (const p of prices) {
    const key = `${p.currency}:${p.period}`;
    if (seen.has(key)) {
      throw new BadRequestException(`Duplicate price for ${key}`);
    }
    seen.add(key);
  }
}

function toPriceResponse(p: PlanPrice): PlanPriceResponse {
  return {
    id: p.id,
    currency: p.currency,
    amountCents: p.amountCents,
    period: p.period,
    maxInstallments: p.maxInstallments,
    isActive: p.isActive,
    stripePriceId: p.stripePriceId,
    storeProductId: p.storeProductId,
  };
}

/** Staff see every price line; students only the purchasable (active) ones. */
function toResponse(
  p: PlanWithRelations,
  includeInactivePrices: boolean,
): PlanResponse {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    tagline: p.tagline,
    isAllAccess: p.isAllAccess,
    revenueCatEntitlementId: p.revenueCatEntitlementId,
    isActive: p.isActive,
    trialDays: p.trialDays,
    sortOrder: p.sortOrder,
    categoryIds: p.categories.map((c) => c.categoryId),
    prices: p.prices
      .filter((x) => includeInactivePrices || x.isActive)
      .map(toPriceResponse),
    stripeProductId: p.stripeProductId,
    syncedToStripe: p.stripeProductId != null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
