import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SiteSettingsService } from '../site-settings/site-settings.service.js';
import type {
  Prisma,
  SubscriptionStatus,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AdminUserListItem,
  MeResponse,
  UpdateMeDto,
} from './users.dto.js';

const ME_FIELDS = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  locale: true,
  timezone: true,
  marketingEmailOptIn: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  onboardedAt: true,
  lastSeenAt: true,
  createdAt: true,
  totalXp: true,
  coins: true,
  petName: true,
  activityFeedOptIn: true,
  theme: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly site?: SiteSettingsService,
  ) {}

  async getById(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ME_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return toMeResponse(user);
  }

  async update(userId: string, patch: UpdateMeDto): Promise<MeResponse> {
    const { onboarded, petName, ...fields } = patch;
    // docs/04 Settings "Locale enable/disable": a disabled locale can't be picked.
    if (fields.locale && this.site) {
      const { locales } = await this.site.get();
      if (!locales.enabled.includes(fields.locale))
        throw new BadRequestException({
          code: 'LOCALE_DISABLED',
          message: `Locale ${fields.locale} is not enabled`,
        });
    }
    if (onboarded === true) {
      // Only the first completion stamps the date.
      await this.prisma.user.updateMany({
        where: { id: userId, onboardedAt: null },
        data: { onboardedAt: new Date() },
      });
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...fields,
        ...(petName !== undefined ? { petName: cleanPetName(petName) } : {}),
      },
      select: ME_FIELDS,
    });
    return toMeResponse(user);
  }

  async listForAdmin(opts: {
    skip: number;
    take: number;
    q?: string;
    role?: UserRole;
    locale?: string;
    lastSeenFrom?: Date;
    lastSeenTo?: Date;
    subscriptionStatus?: SubscriptionStatusFilter;
  }): Promise<{
    items: AdminUserListItem[];
    total: number;
  }> {
    const q = opts.q?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.locale ? { locale: opts.locale } : {}),
      ...(opts.lastSeenFrom || opts.lastSeenTo
        ? {
            lastSeenAt: {
              ...(opts.lastSeenFrom ? { gte: opts.lastSeenFrom } : {}),
              ...(opts.lastSeenTo ? { lte: opts.lastSeenTo } : {}),
            },
          }
        : {}),
      ...subscriptionWhere(opts.subscriptionStatus),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
              { id: q },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip: opts.skip,
        take: opts.take,
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          locale: true,
          lastSeenAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: items.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        locale: u.locale,
        lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
      total,
    };
  }

  async getDetailForAdmin(id: string): Promise<MeResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: ME_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return toMeResponse(user);
  }
}

/**
 * `subscriptionStatus` list filter: a SubscriptionStatus matches users with
 * any subscription in that status; `NONE` matches users who never had one.
 */
export type SubscriptionStatusFilter = SubscriptionStatus | 'NONE';

function subscriptionWhere(
  status: SubscriptionStatusFilter | undefined,
): Prisma.UserWhereInput {
  if (!status) return {};
  if (status === 'NONE') return { subscriptions: { none: {} } };
  return { subscriptions: { some: { status } } };
}

function toMeResponse(u: Pick<User, keyof typeof ME_FIELDS>): MeResponse {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    locale: u.locale,
    timezone: u.timezone,
    marketingEmailOptIn: u.marketingEmailOptIn,
    quietHoursStart: u.quietHoursStart ?? null,
    quietHoursEnd: u.quietHoursEnd ?? null,
    onboardedAt: u.onboardedAt?.toISOString() ?? null,
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    totalXp: u.totalXp,
    coins: u.coins,
    petName: u.petName ?? null,
    activityFeedOptIn: u.activityFeedOptIn,
    theme: (u.theme as MeResponse['theme']) ?? null,
  };
}

/** Collapsed whitespace, max 30 chars; blank → null. */
function cleanPetName(name: string | null): string | null {
  const v = (name ?? '').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 30) : null;
}
