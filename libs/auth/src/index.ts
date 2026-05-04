// Public surface of @codify/auth. See docs/03-shared-libraries §`libs/auth/`.

export { provideAuth } from './lib/provider.js';
export { AuthService } from './lib/auth.service.js';
export { authGuard } from './lib/auth.guard.js';
export { RoleDirective } from './lib/role.directive.js';
export {
  authInterceptor,
  authInterceptorFn,
  AUTH_INTERCEPTOR_PROVIDER,
} from './lib/auth.interceptor.js';
export {
  ALL_ROLES,
  type AuthSession,
  type AuthState,
  type AuthUser,
  type UserRole,
} from './lib/types.js';
