// Public surface of @codify/api-client. See docs/03-shared-libraries §
// `libs/api-client/`.

export { provideApiClient, apiClientInterceptors } from './lib/provider.js';
export { API_CLIENT_CONFIG, type ApiClientConfig } from './lib/api-config.js';

// Typed clients
export { MeClient } from './lib/me.client.js';
export { UsersClient } from './lib/users.client.js';
export { HealthClient } from './lib/health.client.js';
export {
  CategoriesClient,
  type Category,
  type CategoryListResponse,
  type CreateCategoryBody,
  type UpdateCategoryBody,
} from './lib/categories.client.js';

// Idempotency helpers
export { withIdempotency, IDEMPOTENCY_TOKEN, uuidV4 } from './lib/idempotency.js';

// Error mapping
export {
  ProblemDetailsError,
  toProblemDetails,
  type ProblemDetails,
} from './lib/problem-details.js';

// Response types
export type {
  ApiUserRole,
  MeResponse,
  UpdateMeBody,
  AdminUserListItem,
  AdminUserListResponse,
  HealthResponse,
} from './lib/types.js';
