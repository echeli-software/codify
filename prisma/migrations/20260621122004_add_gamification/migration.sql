-- CreateEnum
CREATE TYPE "XpSource" AS ENUM ('LESSON_COMPLETE', 'QUIZ_PERFECT', 'EXERCISE_PASS', 'STREAK_MILESTONE', 'DAILY_QUEST', 'BADGE_UNLOCK', 'LEAGUE_PROMOTION', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "CoinSource" AS ENUM ('LESSON_COMPLETE', 'QUIZ_PERFECT', 'EXERCISE_PASS', 'STREAK_MILESTONE', 'DAILY_QUEST', 'WEEKLY_LEAGUE', 'BADGE_UNLOCK', 'CHEST_OPEN', 'PURCHASE_REFUND', 'PROMO_CODE', 'ADMIN_GRANT', 'ITEM_PURCHASE', 'CHEST_PURCHASE');

-- CreateEnum
CREATE TYPE "MultiplierKind" AS ENUM ('PREMIUM_DEFAULT', 'COURSE_PROMO', 'LESSON_PROMO', 'STREAK_TIER', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "MultiplierTarget" AS ENUM ('XP', 'COINS', 'BOTH');

-- CreateEnum
CREATE TYPE "QuestKind" AS ENUM ('LESSON_COUNT', 'CATEGORY_LESSON_COUNT', 'XP_AMOUNT', 'STREAK_MAINTAIN', 'EXERCISE_PASS');

-- CreateTable
CREATE TABLE "XpEvent" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "source" "XpSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "multiplier" DECIMAL(5,2) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "source" "CoinSource" NOT NULL,
    "multiplier" DECIMAL(5,2),
    "balanceAfter" INTEGER NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Streak" (
    "userId" TEXT NOT NULL,
    "currentDays" INTEGER NOT NULL DEFAULT 0,
    "longestDays" INTEGER NOT NULL DEFAULT 0,
    "freezesAvailable" INTEGER NOT NULL DEFAULT 0,
    "lastActivityDate" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Streak_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Multiplier" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "kind" "MultiplierKind" NOT NULL,
    "target" "MultiplierTarget" NOT NULL DEFAULT 'BOTH',
    "value" DECIMAL(5,2) NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "courseId" TEXT,
    "lessonId" TEXT,
    "streakDaysMin" INTEGER,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Multiplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconName" TEXT,
    "rule" JSONB NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "coinReward" INTEGER NOT NULL DEFAULT 0,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("userId","badgeId")
);

-- CreateTable
CREATE TABLE "QuestTemplate" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "slug" TEXT NOT NULL,
    "kind" "QuestKind" NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "target" INTEGER NOT NULL,
    "paramsJson" JSONB,
    "coinReward" INTEGER NOT NULL DEFAULT 0,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestAssignment" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "assignedFor" TIMESTAMP(3) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QuestAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamificationConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamificationConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "XpEvent_idempotencyKey_key" ON "XpEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "XpEvent_userId_createdAt_idx" ON "XpEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_idempotencyKey_key" ON "CoinTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Multiplier_kind_startsAt_endsAt_idx" ON "Multiplier"("kind", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_slug_key" ON "Badge"("slug");

-- CreateIndex
CREATE INDEX "UserBadge_userId_idx" ON "UserBadge"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestTemplate_slug_key" ON "QuestTemplate"("slug");

-- CreateIndex
CREATE INDEX "QuestAssignment_userId_assignedFor_idx" ON "QuestAssignment"("userId", "assignedFor");

-- CreateIndex
CREATE UNIQUE INDEX "QuestAssignment_userId_templateId_assignedFor_key" ON "QuestAssignment"("userId", "templateId", "assignedFor");

-- AddForeignKey
ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Streak" ADD CONSTRAINT "Streak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Multiplier" ADD CONSTRAINT "Multiplier_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Multiplier" ADD CONSTRAINT "Multiplier_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestAssignment" ADD CONSTRAINT "QuestAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestAssignment" ADD CONSTRAINT "QuestAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuestTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
