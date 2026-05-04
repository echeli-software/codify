import { SetMetadata } from '@nestjs/common';
import type { ApiUser } from './auth.types.js';

export const ROLES_KEY = 'codify:roles';

/**
 * Declarative role gate for controllers/handlers:
 *
 *   @Roles('ADMIN', 'SUPPORT')
 *   @Get()
 *   listUsers() { ... }
 *
 * Empty list = "any authenticated user qualifies" (mirrors the client
 * authGuard semantics). Pair with RolesGuard at the module level.
 */
export const Roles = (...roles: ApiUser['role'][]) => SetMetadata(ROLES_KEY, roles);
