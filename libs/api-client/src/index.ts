// Public surface of @codify/api-client. See docs/03-shared-libraries §
// `libs/api-client/`.

export { provideApiClient, apiClientInterceptors } from './lib/provider.js';
export { API_CLIENT_CONFIG, type ApiClientConfig } from './lib/api-config.js';

// Typed clients
export { MeClient } from './lib/me.client.js';
export { UsersClient } from './lib/users.client.js';
export { DevicesClient, type DevicePlatform } from './lib/devices.client.js';
export {
  CertificatesClient,
  type CertificateView,
  type ReferralView,
  type VerifyResult,
} from './lib/certificates.client.js';
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
export {
  ProgressClient,
  type ProgressItem,
  type UserTotals,
  type CompleteLessonResponse,
  type CourseProgressResponse,
  type RewardResult,
  type RewardBreakdownEntry,
  type StreakInfo,
  type CompletedQuest,
  type UnlockedBadge,
} from './lib/progress.client.js';
export {
  GamificationClient,
  type GamificationSummary,
  type QuestView,
  type QuestKind,
  type QuestTemplate,
  type BadgeView,
  type BadgeDef,
  type CreateQuestTemplateBody,
  type CreateBadgeBody,
  type Multiplier,
  type MultiplierKind,
  type MultiplierTarget,
  type CreateMultiplierBody,
} from './lib/gamification.client.js';
export {
  ItemsClient,
  type Item,
  type ItemSlot,
  type ItemRarity,
  type ShopItem,
  type ShopQuery,
  type InventoryItem,
  type EquippedRef,
  type AvatarResponse,
  type ItemCategory,
  type CreateItemBody,
} from './lib/items.client.js';
export {
  LeaguesClient,
  type CurrentLeague,
  type LeagueMember,
  type Friend,
  type FriendRequest,
  type PublicProfile,
} from './lib/leagues.client.js';
export {
  ExercisesClient,
  type StudentExercise,
  type ExerciseTestCase,
  type ExerciseTestResult,
  type RunResult,
  type SubmitResult,
  type AdminExercise,
  type CreateExerciseBody,
} from './lib/exercises.client.js';
export {
  AiPromptsClient,
  type RubricCriterion,
  type CriterionResult,
  type StudentAiPrompt,
  type GradeResult,
  type AdminAiPrompt,
  type AiPromptBody,
} from './lib/ai-prompts.client.js';
export {
  ScenariosClient,
  type ScenarioChoice,
  type ScenarioNode,
  type ScenarioGraph,
  type StudentScenario,
  type CompleteResult,
  type AdminScenario,
} from './lib/scenarios.client.js';
export {
  PlansClient,
  type Plan,
  type PlanPrice,
  type PlanListResponse,
  type PlanPriceInput,
  type CreatePlanBody,
  type UpdatePlanBody,
  type BillingPeriod,
} from './lib/plans.client.js';
export {
  BillingClient,
  type PaymentMethod,
  type SubscriptionStatus,
  type SubscriptionView,
  type MySubscriptionResponse,
  type CheckoutSessionResponse,
  type LessonAccess,
  type SubscriptionSource,
  type AdminSubscriptionView,
  type ChangeSubscriptionBody,
  type GrantSubscriptionBody,
  type AdminCancelBody,
} from './lib/billing.client.js';
export { type UpdatePlanPriceBody } from './lib/plans.client.js';

// Idempotency helpers
export {
  withIdempotency,
  IDEMPOTENCY_TOKEN,
  uuidV4,
} from './lib/idempotency.js';

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
