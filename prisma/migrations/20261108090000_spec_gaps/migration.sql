-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CoinSource" ADD VALUE 'RETAKE';
ALTER TYPE "CoinSource" ADD VALUE 'SCENARIO_BRANCH';
ALTER TYPE "CoinSource" ADD VALUE 'WEEKLY_BONUS';

-- AlterEnum
ALTER TYPE "MultiplierKind" ADD VALUE 'SURPRISE_BOOST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XpSource" ADD VALUE 'RETAKE';
ALTER TYPE "XpSource" ADD VALUE 'SCENARIO_BRANCH';

-- DropIndex
DROP INDEX "CoinTransaction_userId_createdAt_idx";

-- DropIndex
DROP INDEX "Progress_userId_completedAt_idx";

-- DropIndex
DROP INDEX "XpEvent_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "Badge" ADD COLUMN     "iconAssetId" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EquippedItem" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Multiplier" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activityFeedOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "petName" TEXT,
ADD COLUMN     "theme" TEXT;

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "maxRedemptions" INTEGER,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCodeRedemption" (
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCodeRedemption_pkey" PRIMARY KEY ("promoCodeId","userId")
);

-- CreateTable
CREATE TABLE "CoinBonusPool" (
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinBonusPool_pkey" PRIMARY KEY ("userId","weekStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCodeRedemption_userId_idx" ON "PromoCodeRedemption"("userId");

-- CreateIndex
CREATE INDEX "CoinBonusPool_weekStart_paidAt_idx" ON "CoinBonusPool"("weekStart", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_sha256_key" ON "Asset"("sha256");

-- CreateIndex
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LeagueMembership_leagueId_weeklyXp_idx" ON "LeagueMembership"("leagueId", "weeklyXp" DESC);

-- CreateIndex
CREATE INDEX "Multiplier_userId_endsAt_idx" ON "Multiplier"("userId", "endsAt");

-- CreateIndex
CREATE INDEX "Notification_userId_scheduledFor_idx" ON "Notification"("userId", "scheduledFor");

-- CreateIndex
CREATE INDEX "Progress_userId_completedAt_idx" ON "Progress"("userId", "completedAt" DESC);

-- CreateIndex
CREATE INDEX "XpEvent_userId_createdAt_idx" ON "XpEvent"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Multiplier" ADD CONSTRAINT "Multiplier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinBonusPool" ADD CONSTRAINT "CoinBonusPool_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

