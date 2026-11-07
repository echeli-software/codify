// Public surface of @codify/auth. See docs/03-shared-libraries §`libs/auth/`.

export { provideAuth } from './lib/provider.js';
export { AuthService, type AuthMode } from './lib/auth.service.js';
export { authGuard } from './lib/auth.guard.js';
export { RoleDirective } from './lib/role.directive.js';
export { authInterceptor, authInterceptorFn } from './lib/auth.interceptor.js';
export {
  AUTH_CONFIG,
  CLERK_LOADER,
  safeRedirect,
  isTokenAllowed,
  type AuthConfig,
  type ClerkLike,
  type ClerkLoader,
} from './lib/config.js';
export {
  ALL_ROLES,
  type AuthSession,
  type AuthState,
  type AuthUser,
  type UserRole,
} from './lib/types.js';
