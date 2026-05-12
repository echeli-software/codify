import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
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
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ME_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return toMeResponse(user);
  }

  async update(userId: string, patch: UpdateMeDto): Promise<MeResponse> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...patch },
      select: ME_FIELDS,
    });
    return toMeResponse(user);
  }

  async listForAdmin(opts: { skip: number; take: number }): Promise<{
    items: AdminUserListItem[];
    total: number;
  }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip: opts.skip,
        take: opts.take,
        where: { deletedAt: null },
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
      this.prisma.user.count({ where: { deletedAt: null } }),
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

function toMeResponse(
  u: Pick<User, keyof typeof ME_FIELDS>,
): MeResponse {
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
  };
}
