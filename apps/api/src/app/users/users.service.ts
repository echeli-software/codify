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
import { loadEquippedPet, petNameAlias } from '../items/pet-names.js';
import {
  COUNTRY_UNKNOWN,
  type AdminUserCountry,
  type AdminUserListItem,
  type MeResponse,
  type UpdateMeDto,
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
  onboardingGoal: true,
  country: true,
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
    return this.withPetName(toMeResponse(user));
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
    // Legacy `petName` names the equipped pet (docs/08 §10); User.petName
    // stays the starter pet's mirror, so it is written only for that pet
    // (or when no pet is out).
    let legacyPetName: { petName?: string | null } = {};
    if (petName !== undefined) {
      const name = cleanPetName(petName);
      const pet = await loadEquippedPet(this.prisma, userId);
      if (pet)
        await this.prisma.userItem.update({
          where: { userId_itemId: { userId, itemId: pet.itemId } },
          data: { nickname: name },
        });
      if (!pet || pet.source === 'ONBOARDING')
        legacyPetName = { petName: name };
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...fields, ...legacyPetName },
      select: ME_FIELDS,
    });
    return this.withPetName(toMeResponse(user));
  }

  /** `petName` = the equipped pet's name (see `petNameAlias`). */
  private async withPetName(me: MeResponse): Promise<MeResponse> {
    const pet = await loadEquippedPet(this.prisma, me.id);
    return { ...me, petName: petNameAlias(pet, me.petName) };
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
    /** ISO 3166-1 alpha-2 (upper case) or COUNTRY_UNKNOWN. */
    country?: string;
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
      ...(opts.country
        ? {
            country: opts.country === COUNTRY_UNKNOWN ? null : opts.country,
          }
        : {}),
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
          country: true,
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
        country: u.country ?? null,
      })),
      total,
    };
  }

  /**
   * Countries present among (not deleted) users, most users first; the
   * unknown bucket (country null) last. Feeds the Users country filter.
   */
  async countriesForAdmin(): Promise<{ items: AdminUserCountry[] }> {
    const rows = await this.prisma.user.groupBy({
      by: ['country'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const items = rows
      .map((r) => ({ country: r.country ?? null, users: r._count._all }))
      .sort(
        (a, b) =>
          Number(a.country === null) - Number(b.country === null) ||
          b.users - a.users ||
          (a.country ?? '').localeCompare(b.country ?? ''),
      );
    return { items };
  }

  async getDetailForAdmin(id: string): Promise<MeResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: ME_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return this.withPetName(toMeResponse(user));
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
    onboardingGoal: (u.onboardingGoal as MeResponse['onboardingGoal']) ?? null,
    country: u.country ?? null,
  };
}

/** Collapsed whitespace, max 30 chars; blank → null. */
function cleanPetName(name: string | null): string | null {
  const v = (name ?? '').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, 30) : null;
}
