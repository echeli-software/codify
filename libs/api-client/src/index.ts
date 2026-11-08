// Public surface of @codify/api-client. See docs/03-shared-libraries §
// `libs/api-client/`.

export { provideApiClient, apiClientInterceptors } from './lib/provider.js';
export { API_CLIENT_CONFIG, type ApiClientConfig } from './lib/api-config.js';

// Typed clients
export { MeClient } from './lib/me.client.js';
export {
  UsersClient,
  type UserListQuery,
  type UserSubscriptionFilter,
} from './lib/users.client.js';
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
  type CourseSort,
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
  type CompleteLessonBody,
  type CompleteLessonOptions,
  type CompleteLessonConflictCode,
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
  type AvatarWriteOptions,
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
  type BrowserResultBody,
  type ExerciseTestCase,
  type ExerciseTestResult,
  type RunResult,
  type SubmitResult,
  type AdminExercise,
  type CreateExerciseBody,
  type ExerciseLanguage,
  type ExerciseVerdict,
  type SubmissionStatus,
  type SubmissionView,
  isSubmissionFinal,
} from './lib/exercises.client.js';
export {
  AiPromptsClient,
  type RubricCriterion,
  type CriterionResult,
  type StudentAiPrompt,
  type GradeResult,
  type AdminAiPrompt,
  type AiPromptBody,
  type AiPromptPreview,
  type AiPromptRateLimitCode,
} from './lib/ai-prompts.client.js';
export {
  ScenariosClient,
  type ScenarioChoice,
  type ScenarioNode,
  type ScenarioGraph,
  type StudentScenario,
  type CompleteResult,
  type CompleteScenarioOptions,
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
export type {
  PaymentProviderKind,
  PaymentStatus,
  PaymentView,
  AdminPaymentView,
  PaymentPage,
  StripeStatus,
} from './lib/billing.client.js';

// Engagement area additions (gamification config, leagues, shop, referrals, translations)
export type {
  ListMultipliersQuery,
  RewardAmount,
  GamificationConfigValues,
  GamificationConfigKey,
  GamificationConfigEntry,
  GamificationConfigPatch,
} from './lib/gamification.client.js';
export type { PurchaseResponse } from './lib/items.client.js';
export type {
  LeagueTier,
  LastWeekResult,
  RolloverSummary,
  FriendInvite,
  AcceptInviteResult,
} from './lib/leagues.client.js';
export {
  ReferralsClient,
  type ReferralSummary,
  type ClaimReferralResult,
} from './lib/referrals.client.js';
export {
  TranslationsClient,
  TRANSLATION_FALLBACK_HEADER,
  type ContentLocale,
  type TranslatableEntityType,
  type TranslationStatus,
  type TranslationRow,
  type ListTranslationsQuery,
  type TranslationUpsert,
  type CompletenessCounts,
  type TranslationCompleteness,
  type ResolvedField,
  type ResolvedTranslations,
} from './lib/translations.client.js';

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

// Lesson content delivery: offline bundle + lesson versions.
export type {
  LessonMeta,
  LessonOfflineBundle,
  LessonVersion,
  LessonContentIssue,
} from './lib/lessons.client.js';

// Quizzes, enrollments, uploads, analytics.
export {
  QuizzesClient,
  type QuizAttemptResult,
  type QuizAttemptSummary,
  type QuizQuestionFeedback,
} from './lib/quizzes.client.js';
export {
  EnrollmentsClient,
  type EnrollmentSource,
  type EnrollmentView,
  type MyEnrollment,
  type GrantEnrollmentBody,
} from './lib/enrollments.client.js';
export {
  AssetsClient,
  type AssetKind,
  type AssetView,
  type AssetPage,
  type PresignedUpload,
} from './lib/assets.client.js';
export {
  AnalyticsClient,
  type AnalyticsBatch,
  type AnalyticsEventInput,
  type AnalyticsSummaryRow,
} from './lib/analytics.client.js';
export {
  OpsClient,
  type LedgerDriftMismatch,
  type LedgerDriftReport,
} from './lib/ops.client.js';
export {
  AdminOpsClient,
  filenameFromDisposition,
  type AuditEntry,
  type CursorPage,
  type AdminDashboard,
  type AdminDashboardKpis,
  type TeacherDashboardKpis,
  type DashboardTopCourse,
  type DashboardDropOffLesson,
  type AdminSearchHit,
  type AdminSearchHitType,
  type AdminSearchResults,
  type AuditQuery,
  type AuditExport,
  type AdminLeagueTier,
  type LeagueSnapshot,
  type LeagueDetail,
  type UserInventoryEntry,
  type GrantItemResult,
  type LedgerType,
  type LedgerEntry,
  type LedgerPage,
  type BadgeTestResult,
  type ItemCategoryAdmin,
} from './lib/admin-ops.client.js';

// Account lifecycle + privacy (docs/14 §13) and feature flags (docs/10 §9).
export {
  AccountClient,
  ACCOUNT_DELETED,
  ACCOUNT_SUSPENDED,
  EXPORT_RATE_LIMITED,
  type AccountStatus,
  type AccountStatusView,
  type AdminAccountStatusView,
  type ModerationResult,
  type DeleteAccountResult,
  type AccountExport,
} from './lib/account.client.js';
export {
  FlagsClient,
  FEATURE_DISABLED,
  type FlagEvaluation,
  type FeatureFlag,
  type FeatureFlagValue,
  type CreateFeatureFlagBody,
  type UpdateFeatureFlagBody,
} from './lib/flags.client.js';

// Notification inbox + preferences (docs/05 Notifications, docs/10 §3).
export {
  NotificationsClient,
  type NotificationKind,
  type NotificationAction,
  type InboxNotification,
  type InboxPage,
  type KindPreference,
  type NotificationPreferences,
  type UpdateNotificationPreferencesBody,
} from './lib/notifications.client.js';
// Authoring (round 3): lesson multipliers, translation import/export/complete.
export type { LessonMultiplier } from './lib/lessons.client.js';
export type {
  TranslationFileFormat,
  TranslationRef,
  TranslationImportBody,
  TranslationImportRowError,
  TranslationImportReport,
} from './lib/translations.client.js';
// Social (round 3): starter pet, league history, friends compare/activity, mastery.
export type {
  StarterPetStatus,
  ClaimStarterPetResponse,
} from './lib/items.client.js';
export type {
  LeagueHistoryEntry,
  CompareStats,
  FriendCompare,
  ActivityFeedEntry,
} from './lib/leagues.client.js';
export {
  MasteryClient,
  type MasteryView,
  type MasteryTopic,
  type MasteryCourse,
  type MasteryLevel,
  type SkillNode,
  type SkillNodeState,
} from './lib/mastery.client.js';
export {
  PromoCodesClient,
  type PromoCode,
  type CreatePromoCodeBody,
  type UpdatePromoCodeBody,
  type RedeemPromoCodeResult,
  type PromoCodeErrorCode,
} from './lib/promo-codes.client.js';
export type { SurpriseBoost } from './lib/progress.client.js';
export type { LeagueZones, EconomyJob } from './lib/gamification.client.js';
export {
  SearchClient,
  type CatalogSearchResponse,
  type SearchCourseHit,
  type SearchLessonHit,
} from './lib/search.client.js';
