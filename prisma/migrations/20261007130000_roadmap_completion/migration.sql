-- CreateEnum
CREATE TYPE "EnrollmentSource" AS ENUM ('SELF', 'PROMO', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'SPRITE', 'COVER', 'OTHER');

-- AlterEnum
ALTER TYPE "LessonType" ADD VALUE 'CAPSTONE';

-- AlterTable
ALTER TABLE "PlanPrice" ADD COLUMN     "storeProductId" TEXT;

-- AlterTable
ALTER TABLE "QuestTemplate" ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "pastDueSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "source" "EnrollmentSource" NOT NULL DEFAULT 'SELF',
    "accessUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "answersJson" JSONB NOT NULL,
    "scorePct" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'IMAGE',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGradeCache" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "aiPromptId" TEXT NOT NULL,
    "responseHash" TEXT NOT NULL,
    "scorePct" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "breakdownJson" JSONB NOT NULL,
    "gradedBy" "GradedBy" NOT NULL,
    "rubricHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGradeCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT,
    "anonymousId" TEXT,
    "name" TEXT NOT NULL,
    "props" JSONB,
    "platform" TEXT,
    "appVersion" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Enrollment_courseId_idx" ON "Enrollment"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_userId_courseId_key" ON "Enrollment"("userId", "courseId");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_lessonId_idx" ON "QuizAttempt"("userId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_key_key" ON "Asset"("key");

-- CreateIndex
CREATE INDEX "Asset_kind_createdAt_idx" ON "Asset"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiGradeCache_aiPromptId_responseHash_rubricHash_key" ON "AiGradeCache"("aiPromptId", "responseHash", "rubricHash");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_occurredAt_idx" ON "AnalyticsEvent"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanPrice_storeProductId_key" ON "PlanPrice"("storeProductId");

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

