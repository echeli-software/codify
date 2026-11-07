import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { DevicePlatform } from '@prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CRUD for a user's push device tokens.
 *
 * Token ownership (anti-hijack): a token already bound to *another* user is
 * never silently moved. The first registration attempt by a different user
 * deletes the old binding (so the previous owner stops receiving pushes on
 * a device they may no longer control — e.g. account switch on a shared
 * phone), logs it, and answers 409 `device.rebind_required`. The token is
 * bound to the new user only when the client registers it again. This way
 * a leaked token can't be quietly re-pointed in one call, the previous
 * owner's pushes never reach the new account, and every ownership change
 * leaves an audit trail in the logs.
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(
    userId: string,
    token: string,
    platform: DevicePlatform,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.deviceToken.findUnique({
      where: { token },
      select: { id: true, userId: true },
    });

    if (existing && existing.userId === userId) {
      return this.prisma.deviceToken.update({
        where: { id: existing.id },
        data: { platform, lastSeenAt: new Date() },
        select: { id: true },
      });
    }

    if (existing) {
      await this.prisma.deviceToken.deleteMany({
        where: { id: existing.id, userId: existing.userId },
      });
      this.logger.warn(
        `Push token re-registered by user ${userId}; removed previous binding of user ${existing.userId} — client must register again`,
      );
      throw new ConflictException({
        message:
          'This device was registered to another account. Register it again to bind it to yours.',
        code: 'device.rebind_required',
      });
    }

    try {
      return await this.prisma.deviceToken.create({
        data: { userId, token, platform },
        select: { id: true },
      });
    } catch (err) {
      // Concurrent registration of the same token: re-run the ownership check.
      if (isUniqueViolation(err)) return this.register(userId, token, platform);
      throw err;
    }
  }

  async unregister(
    userId: string,
    token: string,
  ): Promise<{ removed: number }> {
    const res = await this.prisma.deviceToken.deleteMany({
      where: { token, userId },
    });
    return { removed: res.count };
  }

  listTokens(userId: string) {
    return this.prisma.deviceToken.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
