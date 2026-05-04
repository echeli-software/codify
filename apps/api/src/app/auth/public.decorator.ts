import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'codify:public';

/**
 * Mark a route as anonymously accessible. Skips RolesGuard entirely.
 * Used for /api/health and any pre-auth bootstrap endpoints.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
