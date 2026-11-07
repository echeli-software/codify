import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { FeatureFlagService } from './feature-flag.service.js';

export const FEATURE_KEY = 'codify:feature';

/**
 * Server-side gating for a product surface: when the flag evaluates off
 * for the caller the route answers 404 `{ code: 'FEATURE_DISABLED',
 * feature }` — as if it did not exist. Runs after the global RolesGuard,
 * so unauthenticated callers still get 401 first.
 *
 *   @RequireFeature('leagues.enabled')
 */
export const RequireFeature = (key: string) =>
  applyDecorators(SetMetadata(FEATURE_KEY, key), UseGuards(FeatureGuard));

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(
      FEATURE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!key) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (await this.flags.isEnabled(key, req.user?.userId ?? null)) return true;
    throw new NotFoundException({
      code: 'FEATURE_DISABLED',
      message: `This feature is not available (${key})`,
      feature: key,
    });
  }
}
