import { Injectable } from '@nestjs/common';
import type { DevicePlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** CRUD for a user's push device tokens. */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Register (or refresh) a token. Re-binds the token to the current user. */
  async register(userId: string, token: string, platform: DevicePlatform): Promise<{ id: string }> {
    const row = await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastSeenAt: new Date() },
      select: { id: true },
    });
    return row;
  }

  async unregister(userId: string, token: string): Promise<{ removed: number }> {
    const res = await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { removed: res.count };
  }

  listTokens(userId: string) {
    return this.prisma.deviceToken.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });
  }
}
