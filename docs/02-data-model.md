# 02 — Data Model

PostgreSQL 16 via Prisma 5. Single tenant. UUID primary keys (v7 for time-ordering where ordering matters: `XpEvent`, `CoinTransaction`, `Notification`).

## Conventions

- **IDs**: `String @id @default(dbgenerated("uuid_generate_v7()"))`. Enable extension `uuid-ossp` and a `uuidv7()` SQL function (we ship a small migration).
- **Timestamps**: every table has `createdAt` (DEFAULT now()) and, where mutable, `updatedAt` (managed by Prisma).
- **Soft delete**: only on `User`, `Course`, `Lesson`, `Item`. Use `deletedAt: DateTime?` and a Prisma middleware to filter. Everything else hard-deletes.
- **Money**: `Int` cents, never `Float`. Currency code stored separately (`String` ISO-4217).
- **Locale**: BCP-47 strings (`pt-BR`, `en-US`).
- **Enums**: Prisma enums for closed sets; `String` for open sets that admins extend (e.g. `Badge.slug`).
- **Audit**: separate `AuditLog` table for admin actions. Append-only.

## Schema (Prisma)

> The schema below is the canonical source. Migrations are generated from it. Comments use `///` for Prisma JSDoc; runtime comments use `//`.

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────

enum UserRole {
  STUDENT
  TEACHER
  SUPPORT
  ADMIN
}

model User {
  id            String    @id @default(dbgenerated("uuid_generate_v7()"))
  clerkId       String    @unique
  email         String    @unique
  displayName   String
  locale        String    @default("pt-BR")
  timezone      String    @default("America/Sao_Paulo")
  role          UserRole  @default(STUDENT)
  avatarConfig  Json?     /// AvatarConfig — see 08-avatar-and-shop.md
  /// Quiet-hours window in user-local minutes-from-midnight (e.g. 22*60..8*60).
  /// Null = use defaults (22:00–08:00). See 10-engagement.md §3.
  quietHoursStart Int?
  quietHoursEnd   Int?
  marketingEmailOptIn Boolean @default(false)
  onboardedAt   DateTime?
  lastSeenAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?

  enrollments      Enrollment[]
  subscriptions    Subscription[]
  progress         Progress[]
  xpEvents         XpEvent[]
  coinTransactions CoinTransaction[]
  streak           Streak?
  userBadges       UserBadge[]
  userItems        UserItem[]
  equippedItems    EquippedItem[]
  questAssignments QuestAssignment[]
  leagueMemberships LeagueMembership[]
  notifications    Notification[]
  submissions      Submission[]
  friendRequestsSent     FriendRequest[] @relation("Sender")
  friendRequestsReceived FriendRequest[] @relation("Receiver")
  friendsA Friendship[] @relation("FriendA")
  friendsB Friendship[] @relation("FriendB")
  authoredCourses  Course[] @relation("CourseAuthor")

  @@index([role])
  @@index([lastSeenAt])
}

// ─────────────────────────────────────────────────────────────────────
// Assets (referenced by Course.coverAssetId, Lesson images, Item.spriteAssetId,
// Badge.iconAssetId, etc.). See 06-content-authoring.md §10.
// ─────────────────────────────────────────────────────────────────────

model Asset {
  id          String   @id @default(dbgenerated("uuid_generate_v7()"))
  mime        String   /// e.g. "image/svg+xml", "image/png"
  sizeBytes   Int
  width       Int?
  height      Int?
  sha256      String   @unique  /// dedupe + integrity
  uploaderId  String?  /// User.id of uploader
  storageKey  String   /// R2 object key
  createdAt   DateTime @default(now())

  @@index([mime])
}

// ─────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────

enum CourseStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

model Course {
  id            String       @id @default(dbgenerated("uuid_generate_v7()"))
  slug          String       @unique
  authorId      String
  author        User         @relation("CourseAuthor", fields: [authorId], references: [id])
  sourceLocale  String       @default("pt-BR")
  status        CourseStatus @default(DRAFT)
  difficulty    Int          @default(1) /// 1-5
  estimatedMinutes Int       @default(60)
  coverAssetId  String?
  publishedAt   DateTime?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  deletedAt     DateTime?

  modules        Module[]
  categories     CourseCategory[]
  enrollments    Enrollment[]
  multipliers    Multiplier[]    /// Course-level coin/XP multipliers — see 07-gamification.md
  translations   ContentTranslation[] @relation("CourseTranslations")

  @@index([status, publishedAt])
  @@index([authorId])
}

model Module {
  id        String   @id @default(dbgenerated("uuid_generate_v7()"))
  courseId  String
  course    Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  order     Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  lessons      Lesson[]
  translations ContentTranslation[] @relation("ModuleTranslations")

  @@unique([courseId, order])
}

enum LessonType {
  READING
  QUIZ
  EXERCISE
  AI_PROMPT
  SCENARIO
}

model Lesson {
  id              String     @id @default(dbgenerated("uuid_generate_v7()"))
  moduleId        String
  module          Module     @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  order           Int
  type            LessonType
  isFree          Boolean    @default(false)
  estimatedMinutes Int       @default(5)
  baseXp          Int        @default(10)
  baseCoins       Int        @default(5)
  contentJson     Json       /// Tiptap doc — see 06-content-authoring.md
  exerciseId      String?    @unique  /// nullable; only for EXERCISE lessons
  exercise        Exercise?  @relation(fields: [exerciseId], references: [id])
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  deletedAt       DateTime?

  progress     Progress[]
  multipliers  Multiplier[]
  translations ContentTranslation[] @relation("LessonTranslations")

  @@unique([moduleId, order])
  @@index([type])
}

// ─────────────────────────────────────────────────────────────────────
// Categories & Plans
// ─────────────────────────────────────────────────────────────────────

model Category {
  id          String   @id @default(dbgenerated("uuid_generate_v7()"))
  slug        String   @unique
  iconName    String?
  colorToken  String?  /// Refers to a token in libs/ui-tokens
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  courses      CourseCategory[]
  plans        PlanCategory[]
  translations ContentTranslation[] @relation("CategoryTranslations")
}

model CourseCategory {
  courseId   String
  categoryId String
  course     Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  @@id([courseId, categoryId])
}

enum BillingPeriod {
  MONTHLY
  ANNUAL
}

model Plan {
  id              String        @id @default(dbgenerated("uuid_generate_v7()"))
  slug            String        @unique
  stripeProductId String        @unique
  isAllAccess     Boolean       @default(false)
  isActive        Boolean       @default(true)
  sortOrder       Int           @default(0)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  prices        PlanPrice[]
  categories    PlanCategory[]
  subscriptions Subscription[]
  translations  ContentTranslation[] @relation("PlanTranslations")
}

model PlanPrice {
  id              String        @id @default(dbgenerated("uuid_generate_v7()"))
  planId          String
  plan            Plan          @relation(fields: [planId], references: [id], onDelete: Cascade)
  stripePriceId   String        @unique
  currency        String        /// ISO-4217, e.g. "BRL"
  amountCents     Int
  period          BillingPeriod
  maxInstallments Int?          /// Brazil: parcelamento up to 12. Null = no installments.
  isActive        Boolean       @default(true)

  @@unique([planId, currency, period])
}

model PlanCategory {
  planId     String
  categoryId String
  plan       Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  @@id([planId, categoryId])
}

// ─────────────────────────────────────────────────────────────────────
// Subscriptions & Access
// ─────────────────────────────────────────────────────────────────────

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  INCOMPLETE
  INCOMPLETE_EXPIRED
  UNPAID
  PAUSED
}

/// Provenance of a subscription. Architectural prep for App Store / Play Billing
/// via RevenueCat (phase 11). At launch only STRIPE_WEB is used.
enum SubscriptionSource {
  STRIPE_WEB
  APPLE_IAP
  GOOGLE_PLAY
  ADMIN_GRANT
}

model Subscription {
  id                   String             @id @default(dbgenerated("uuid_generate_v7()"))
  userId               String
  user                 User               @relation(fields: [userId], references: [id])
  planId               String
  plan                 Plan               @relation(fields: [planId], references: [id])
  source               SubscriptionSource @default(STRIPE_WEB)
  stripeSubscriptionId String             @unique
  stripeCustomerId     String
  status               SubscriptionStatus
  currentPeriodStart   DateTime
  currentPeriodEnd     DateTime
  cancelAtPeriodEnd    Boolean            @default(false)
  canceledAt           DateTime?
  trialEndsAt          DateTime?
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt

  @@index([userId, status])
  @@index([stripeCustomerId])
}

enum EnrollmentSource {
  PLAN          /// Granted by an active subscription
  FREE          /// Course flagged free entirely
  GIFT          /// Manually granted
  PROMO         /// Granted by a promotional code
}

model Enrollment {
  id        String           @id @default(dbgenerated("uuid_generate_v7()"))
  userId    String
  user      User             @relation(fields: [userId], references: [id])
  courseId  String
  course    Course           @relation(fields: [courseId], references: [id])
  source    EnrollmentSource
  startedAt DateTime         @default(now())

  @@unique([userId, courseId])
  @@index([courseId])
}

enum ProgressStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
}

model Progress {
  id           String         @id @default(dbgenerated("uuid_generate_v7()"))
  userId       String
  user         User           @relation(fields: [userId], references: [id])
  lessonId     String
  lesson       Lesson         @relation(fields: [lessonId], references: [id])
  status       ProgressStatus @default(IN_PROGRESS)
  scorePct     Int?           /// 0-100 for quiz/exercise lessons
  attemptCount Int            @default(0)
  lastSeenAt   DateTime       @default(now())
  completedAt  DateTime?

  @@unique([userId, lessonId])
  @@index([userId, completedAt])
}

// ─────────────────────────────────────────────────────────────────────
// Gamification ledger (server-authoritative, append-only)
// ─────────────────────────────────────────────────────────────────────

enum XpSource {
  LESSON_COMPLETE
  QUIZ_PERFECT
  EXERCISE_PASS
  STREAK_MILESTONE
  DAILY_QUEST
  BADGE_UNLOCK
  LEAGUE_PROMOTION
  ADMIN_GRANT
}

model XpEvent {
  id           String   @id @default(dbgenerated("uuid_generate_v7()"))
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  source       XpSource
  amount       Int
  multiplier   Decimal  @db.Decimal(5, 2)  /// Effective multiplier applied (e.g. 2.50)
  refType      String?  /// e.g. "lesson", "quest"
  refId        String?
  idempotencyKey String? @unique
  createdAt    DateTime @default(now())

  @@index([userId, createdAt])
}

enum CoinSource {
  LESSON_COMPLETE
  QUIZ_PERFECT
  EXERCISE_PASS
  STREAK_MILESTONE
  DAILY_QUEST
  WEEKLY_LEAGUE
  BADGE_UNLOCK
  CHEST_OPEN
  PURCHASE_REFUND
  PROMO_CODE
  ADMIN_GRANT

  /// Spend
  ITEM_PURCHASE
  CHEST_PURCHASE
}

model CoinTransaction {
  id             String     @id @default(dbgenerated("uuid_generate_v7()"))
  userId         String
  user           User       @relation(fields: [userId], references: [id])
  delta          Int        /// positive = earn, negative = spend
  source         CoinSource
  multiplier     Decimal?   @db.Decimal(5, 2)  /// Null for spends
  balanceAfter   Int        /// Denormalized for fast read of current balance
  refType        String?
  refId          String?
  idempotencyKey String?    @unique
  createdAt      DateTime   @default(now())

  @@index([userId, createdAt])
}

model Streak {
  userId           String   @id
  user             User     @relation(fields: [userId], references: [id])
  currentDays      Int      @default(0)
  longestDays      Int      @default(0)
  freezesAvailable Int      @default(0)
  lastActivityDate DateTime /// Date in user's local TZ, normalized to midnight
  updatedAt        DateTime @updatedAt
}

// ─────────────────────────────────────────────────────────────────────
// Multipliers (configurable; resolved at reward time)
// ─────────────────────────────────────────────────────────────────────

enum MultiplierKind {
  PREMIUM_DEFAULT     /// Global default for paid users
  COURSE_PROMO        /// Bound to a Course
  LESSON_PROMO        /// Bound to a Lesson
  STREAK_TIER         /// Auto-applied at streak thresholds
  CAMPAIGN            /// Time-bound global campaign
}
/// League promotion is a one-shot reward (XP + coins + freeze), not a multiplier.
/// See 07-gamification.md §9.

enum MultiplierTarget {
  XP
  COINS
  BOTH
}

model Multiplier {
  id          String           @id @default(dbgenerated("uuid_generate_v7()"))
  kind        MultiplierKind
  target      MultiplierTarget @default(BOTH)
  value       Decimal          @db.Decimal(5, 2)  /// e.g. 2.00, 4.00
  startsAt    DateTime?
  endsAt      DateTime?
  /// Optional bindings — at most one of (courseId, lessonId, streakDaysMin) set
  courseId    String?
  course      Course?          @relation(fields: [courseId], references: [id])
  lessonId    String?
  lesson      Lesson?          @relation(fields: [lessonId], references: [id])
  streakDaysMin Int?           /// e.g. 7, 14, 30
  description String?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([kind, startsAt, endsAt])
}

// ─────────────────────────────────────────────────────────────────────
// Badges & Quests
// ─────────────────────────────────────────────────────────────────────

model Badge {
  id          String      @id @default(dbgenerated("uuid_generate_v7()"))
  slug        String      @unique
  iconAssetId String
  rule        Json        /// BadgeRule DSL — see 07-gamification.md
  xpReward    Int         @default(0)
  coinReward  Int         @default(0)
  isHidden    Boolean     @default(false) /// Surprise badges
  createdAt   DateTime    @default(now())

  userBadges   UserBadge[]
  translations ContentTranslation[] @relation("BadgeTranslations")
}

model UserBadge {
  userId    String
  badgeId   String
  user      User     @relation(fields: [userId], references: [id])
  badge     Badge    @relation(fields: [badgeId], references: [id])
  awardedAt DateTime @default(now())
  @@id([userId, badgeId])
}

enum QuestKind {
  LESSON_COUNT
  CATEGORY_LESSON_COUNT
  XP_AMOUNT
  STREAK_MAINTAIN
  EXERCISE_PASS
}

model QuestTemplate {
  id           String    @id @default(dbgenerated("uuid_generate_v7()"))
  slug         String    @unique
  kind         QuestKind
  target       Int       /// e.g. 3 lessons, 100 XP
  paramsJson   Json?     /// e.g. { "categorySlug": "frontend" }
  coinReward   Int
  xpReward     Int
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now())

  assignments  QuestAssignment[]
  translations ContentTranslation[] @relation("QuestTranslations")
}

model QuestAssignment {
  id          String        @id @default(dbgenerated("uuid_generate_v7()"))
  userId      String
  user        User          @relation(fields: [userId], references: [id])
  templateId  String
  template    QuestTemplate @relation(fields: [templateId], references: [id])
  assignedFor DateTime      /// Date in user's local TZ — the quest's "day"
  progress    Int           @default(0)
  completedAt DateTime?

  @@unique([userId, templateId, assignedFor])
  @@index([userId, assignedFor])
}

// ─────────────────────────────────────────────────────────────────────
// Leagues
// ─────────────────────────────────────────────────────────────────────

enum LeagueTier {
  BRONZE
  SILVER
  GOLD
  PLATINUM
  DIAMOND
}

model League {
  id        String     @id @default(dbgenerated("uuid_generate_v7()"))
  tier      LeagueTier
  weekStart DateTime   /// UTC Monday 00:00
  cohortKey String     /// random shard key to scatter users into ~30-person groups
  createdAt DateTime   @default(now())

  members LeagueMembership[]

  @@unique([tier, weekStart, cohortKey])
  @@index([weekStart])
}

model LeagueMembership {
  leagueId    String
  userId      String
  league      League @relation(fields: [leagueId], references: [id])
  user        User   @relation(fields: [userId], references: [id])
  weeklyXp    Int    @default(0)
  finalRank   Int?
  promoted    Boolean?
  demoted     Boolean?
  /// Set by the rollover job in the same transaction that grants promotion rewards.
  /// Used as the idempotency token: retries skip rows where rewardedAt IS NOT NULL.
  rewardedAt  DateTime?
  @@id([leagueId, userId])
  @@index([userId])
}

// ─────────────────────────────────────────────────────────────────────
// Avatar shop
// ─────────────────────────────────────────────────────────────────────

enum ItemSlot {
  PET
  BACKGROUND
  TOP
  BOTTOM
  SHOES
  HAT
  HAIR
  GLASSES
  ACCESSORY
  FRAME
  EMOTE
}

enum ItemRarity {
  COMMON
  UNCOMMON
  RARE
  EPIC
  LEGENDARY
}

model ItemCategory {
  slug      String   @id
  sortOrder Int      @default(0)
  items     Item[]
  translations ContentTranslation[] @relation("ItemCategoryTranslations")
}

model Item {
  id              String       @id @default(dbgenerated("uuid_generate_v7()"))
  slug            String       @unique
  slot            ItemSlot
  categorySlug    String
  category        ItemCategory @relation(fields: [categorySlug], references: [slug])
  rarity          ItemRarity   @default(COMMON)
  costCoins       Int          @default(0)
  requiredLevel   Int          @default(1)
  isPremiumOnly   Boolean      @default(false)
  isLimitedDrop   Boolean      @default(false)
  dropStartsAt    DateTime?
  dropEndsAt      DateTime?
  spriteAssetId   String       /// SVG asset
  thumbnailAssetId String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  deletedAt       DateTime?

  userItems     UserItem[]
  equippedItems EquippedItem[]
  translations  ContentTranslation[] @relation("ItemTranslations")

  @@index([slot, rarity])
  @@index([dropStartsAt, dropEndsAt])
}

/// Distinct from CoinSource: this enum tags how an item entered an inventory,
/// not how coins moved.
enum ItemAcquisitionSource {
  PURCHASE       /// Bought with coins
  CHEST          /// Pulled from a chest
  ADMIN_GRANT    /// Manual grant by support/admin
  PROMO          /// Awarded by a campaign / promo code
  ONBOARDING     /// First-cosmetic gift
  REFUND_RESTORE /// Restored after refund reversal
}

model UserItem {
  id         String                @id @default(dbgenerated("uuid_generate_v7()"))
  userId     String
  user       User                  @relation(fields: [userId], references: [id])
  itemId     String
  item       Item                  @relation(fields: [itemId], references: [id])
  source     ItemAcquisitionSource
  acquiredAt DateTime              @default(now())

  @@unique([userId, itemId])
}

model EquippedItem {
  userId String
  slot   ItemSlot
  itemId String
  user   User   @relation(fields: [userId], references: [id])
  item   Item   @relation(fields: [itemId], references: [id])
  @@id([userId, slot])
}

// ─────────────────────────────────────────────────────────────────────
// Social
// ─────────────────────────────────────────────────────────────────────

enum FriendRequestStatus {
  PENDING
  ACCEPTED
  REJECTED
  CANCELED
}

model FriendRequest {
  id         String              @id @default(dbgenerated("uuid_generate_v7()"))
  senderId   String
  receiverId String
  sender     User                @relation("Sender",   fields: [senderId],   references: [id])
  receiver   User                @relation("Receiver", fields: [receiverId], references: [id])
  status     FriendRequestStatus @default(PENDING)
  createdAt  DateTime            @default(now())
  resolvedAt DateTime?

  @@index([receiverId, status])
}

model Friendship {
  userAId  String
  userBId  String
  userA    User     @relation("FriendA", fields: [userAId], references: [id])
  userB    User     @relation("FriendB", fields: [userBId], references: [id])
  since    DateTime @default(now())
  /// Convention: userAId < userBId lexicographically
  @@id([userAId, userBId])
}

// ─────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────

enum NotificationChannel {
  PUSH
  EMAIL
  IN_APP
}

enum NotificationKind {
  STREAK_REMINDER
  DAILY_QUEST
  FRIEND_NUDGE
  LEAGUE_RESULT
  ITEM_DROP
  PROMO
  BILLING
  SYSTEM
}

model Notification {
  id        String              @id @default(dbgenerated("uuid_generate_v7()"))
  userId    String
  user      User                @relation(fields: [userId], references: [id])
  channel   NotificationChannel
  kind      NotificationKind
  payload   Json
  scheduledFor DateTime?
  sentAt    DateTime?
  readAt    DateTime?
  createdAt DateTime            @default(now())

  @@index([userId, readAt])
  @@index([scheduledFor])
}

// ─────────────────────────────────────────────────────────────────────
// Exercises (Judge0 contract — see 12-code-execution.md)
// ─────────────────────────────────────────────────────────────────────

model Exercise {
  id              String   @id @default(dbgenerated("uuid_generate_v7()"))
  language        String   /// e.g. "javascript", "python", "typescript"
  starterCode     String
  solutionCode    String   /// Reference solution; never sent to client
  testHarness     String   /// Test runner code
  timeLimitMs     Int      @default(2000)
  memoryLimitKb   Int      @default(128_000)
  hiddenTestsJson Json     /// Tests not visible to student until pass
  visibleTestsJson Json    /// Sample tests shown in UI
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  lesson      Lesson?
  submissions Submission[]
}

enum SubmissionStatus {
  PENDING       /// Queued, awaiting Judge0 worker
  RUNNING       /// Worker has started execution
  COMPLETE      /// Verdict assigned (success or fail)
  WORKER_LOST   /// Worker died before reporting; reconciliation candidate
}

enum SubmissionVerdict {
  PASS
  FAIL
  ERROR
  TIMEOUT
  MEMORY
  RUNTIME
}

model Submission {
  id             String              @id @default(dbgenerated("uuid_generate_v7()"))
  userId         String
  user           User                @relation(fields: [userId], references: [id])
  exerciseId     String
  exercise       Exercise            @relation(fields: [exerciseId], references: [id])
  code           String
  status         SubmissionStatus    @default(PENDING)
  verdict        SubmissionVerdict?  /// Null until status = COMPLETE
  runtimeMs      Int?
  memoryKb       Int?
  output         String?
  scorePct       Int?                /// 0-100 across visible+hidden tests; null until complete
  idempotencyKey String?             @unique
  createdAt      DateTime            @default(now())
  completedAt    DateTime?

  @@index([userId, createdAt])
  @@index([exerciseId])
  @@index([status])
}

// ─────────────────────────────────────────────────────────────────────
// Translations (content-level)
// ─────────────────────────────────────────────────────────────────────

enum TranslatableEntity {
  COURSE
  MODULE
  LESSON
  CATEGORY
  PLAN
  BADGE
  ITEM
  ITEM_CATEGORY
  QUEST
}

model ContentTranslation {
  id          String             @id @default(dbgenerated("uuid_generate_v7()"))
  entityType  TranslatableEntity
  entityId    String
  locale      String
  field       String  /// e.g. "title", "description", "contentJson"
  value       String  /// Stringified — JSON-encoded if `field` represents a JSON column
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  /// Inverse relations (one per entity) — declared with named relations
  course        Course?      @relation("CourseTranslations",       fields: [entityId], references: [id], map: "ct_course_fk")
  module        Module?      @relation("ModuleTranslations",       fields: [entityId], references: [id], map: "ct_module_fk")
  lesson        Lesson?      @relation("LessonTranslations",       fields: [entityId], references: [id], map: "ct_lesson_fk")
  category      Category?    @relation("CategoryTranslations",     fields: [entityId], references: [id], map: "ct_category_fk")
  plan          Plan?        @relation("PlanTranslations",         fields: [entityId], references: [id], map: "ct_plan_fk")
  badge         Badge?       @relation("BadgeTranslations",        fields: [entityId], references: [id], map: "ct_badge_fk")
  item          Item?        @relation("ItemTranslations",         fields: [entityId], references: [id], map: "ct_item_fk")
  itemCategory  ItemCategory?@relation("ItemCategoryTranslations", fields: [entityId], references: [id], map: "ct_itemcat_fk")
  questTemplate QuestTemplate?@relation("QuestTranslations",       fields: [entityId], references: [id], map: "ct_quest_fk")

  @@unique([entityType, entityId, locale, field])
  @@index([entityType, entityId])
}

// NOTE: the polymorphic relations above are pragmatic, not pure.
// In practice we query by (entityType, entityId, locale) and resolve via the
// API layer. The named relations are only there so Prisma cascades work.

// ─────────────────────────────────────────────────────────────────────
// Configuration (admin-editable singletons)
// ─────────────────────────────────────────────────────────────────────

/// Server-side feature flags. Read-mostly; changes audited.
model FeatureFlag {
  key       String   @id /// e.g. "leagues.enabled", "shop.enabled"
  value     Json     /// { enabled: bool, rolloutPct?: int, variants?: any }
  isActive  Boolean  @default(true)
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())
}

/// Tunables that admins edit (default coin/XP rates, daily caps, refund window,
/// streak tier values, premium multiplier default). Stored as one row keyed by
/// `key`; `value` shape is documented per key in the admin Settings UI.
model GamificationConfig {
  key       String   @id /// e.g. "coinDailyCap.LESSON_COMPLETE"
  value     Json
  updatedAt DateTime @updatedAt
}

// ─────────────────────────────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────────────────────────────

model AuditLog {
  id        String   @id @default(dbgenerated("uuid_generate_v7()"))
  actorId   String?
  actorRole UserRole?
  action    String
  entity    String?
  entityId  String?
  diff      Json?
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([entity, entityId])
}

// ─────────────────────────────────────────────────────────────────────
// Idempotency keys (Redis-backed primarily; this is for long-term audit
// of billing/gamification critical paths)
// ─────────────────────────────────────────────────────────────────────

model IdempotencyRecord {
  key       String   @id
  scope     String   /// e.g. "lesson_complete", "stripe_webhook"
  userId    String?
  responseHash String?
  createdAt DateTime @default(now())

  @@index([scope, createdAt])
}
```

## Notes on contentious decisions

### `ContentTranslation` polymorphism
Prisma doesn't model polymorphic associations natively. We accept the awkward "many nullable FKs" approach because we want cascade deletes when an entity disappears. Day-to-day reads use `(entityType, entityId, locale)` queries that bypass the relations entirely. We could go to a fully unstructured `(entityType, entityId)` with no FK, but cascade cleanup would then need a periodic job — worse trade-off.

### Denormalized `CoinTransaction.balanceAfter`
The ledger is the source of truth. `balanceAfter` is a write-side denormalization so reading the current balance is `SELECT balanceAfter FROM CoinTransaction WHERE userId = ? ORDER BY createdAt DESC LIMIT 1` instead of `SUM(delta)`. Recompute jobs verify drift nightly and emit an alert if mismatched.

### Why not store XP balance similarly?
We do — implicitly. The student's current XP is `SUM(amount) FROM XpEvent`. If this becomes hot, we add `User.xpTotal` and update transactionally. Premature for now.

### `Streak.lastActivityDate` is in the user's local TZ
Streaks reset based on the user's perceived "day". Storing in UTC means a São Paulo user who learns at 23:30 BRT and 00:30 BRT the next day would lose their streak across UTC-day boundaries. We normalize to the user's TZ at write time.

### `Multiplier` table
Configurable multipliers live as rows. The multiplier resolver (see [07-gamification.md](./07-gamification.md)) is the single place that combines them for any reward event. This is what enables "4x coins on this specific lesson" without code changes.

### `IdempotencyRecord` table vs Redis-only
Postgres is authoritative; Redis is a hot-path cache. On a write: Postgres unique constraint on `key` is the source of truth — duplicate keys fail there. Redis is populated optimistically for fast lookups but a Redis miss falls back to Postgres. If Redis-write succeeds and Postgres-write fails, the request fails (caller retries with same key); if Postgres succeeds and Redis fails, a background tickle re-populates Redis. The unique constraint guarantees no double-execution regardless of cache state.

### `Asset` model
Every catalog entity (`Course.coverAssetId`, lesson images via `LessonDoc`, `Item.spriteAssetId`/`thumbnailAssetId`, `Badge.iconAssetId`) references asset IDs. Centralizing them in `Asset` lets us enforce existence on save, dedupe by `sha256`, run R2 cleanup on delete, and store SVG-sanitization metadata in one place.

## Indexing strategy

Beyond the indexes declared inline:
- `XpEvent (userId, createdAt DESC)` — feed query for "your recent activity".
- `CoinTransaction (userId, createdAt DESC)` — same.
- `Progress (userId, completedAt DESC) WHERE completedAt IS NOT NULL` — partial index, used for streak calculation and "today's lessons".
- `LeagueMembership (leagueId, weeklyXp DESC)` — leaderboard ranking.
- `Notification (userId, scheduledFor) WHERE sentAt IS NULL` — partial, used by the scheduler.

Add real indexes by running `EXPLAIN ANALYZE` on actual production queries; do not pre-index speculatively beyond the obvious.

## Migration & seed strategy

- All migrations are generated by `prisma migrate dev` locally, committed to git, and applied via `prisma migrate deploy` in CI.
- `prisma/seed.ts` populates: dev admin user (Clerk dev account), a few categories, two demo plans, a 3-lesson demo course (one free), 12 starter avatar items, 6 starter badges, 3 daily quest templates.
- Seed is idempotent — safe to run repeatedly against a non-prod DB.

## Backup & retention

- Postgres: DO Managed automated daily backups + 7-day PITR (default tier).
- Long-term: weekly logical dump to Cloudflare R2 cold storage, 90-day retention.
- Deleted users (LGPD): hard-delete after 30 days from `User.deletedAt`. Their gamification ledger is anonymized (userId rotated to a tombstone) but kept for accounting integrity.
