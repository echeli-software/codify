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
export {
  CoursesClient,
  type CourseStatus,
  type LessonType,
  type CourseListItem,
  type CourseListResponse,
  type CourseModuleSummary,
  type CourseLessonSummary,
  type CourseDetail,
  type ListCoursesQuery,
  type CreateCourseBody,
  type UpdateCourseBody,
} from './lib/courses.client.js';
export {
  ModulesClient,
  type CourseModule,
  type CreateModuleBody,
  type UpdateModuleBody,
} from './lib/modules.client.js';
export {
  LessonsClient,
  type Lesson,
  type CreateLessonBody,
  type UpdateLessonBody,
} from './lib/lessons.client.js';

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
