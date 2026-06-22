-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "revenueCatEntitlementId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "revenueCatUserId" TEXT,
ADD COLUMN     "storeProductId" TEXT,
ADD COLUMN     "storeTransactionId" TEXT,
ALTER COLUMN "stripeSubscriptionId" DROP NOT NULL,
ALTER COLUMN "stripeCustomerId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Plan_revenueCatEntitlementId_key" ON "Plan"("revenueCatEntitlementId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_storeTransactionId_key" ON "Subscription"("storeTransactionId");

-- CreateIndex
CREATE INDEX "Subscription_revenueCatUserId_idx" ON "Subscription"("revenueCatUserId");
