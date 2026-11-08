-- AlterTable
ALTER TABLE "User" ADD COLUMN     "onboardingGoal" TEXT;

-- AlterTable
ALTER TABLE "UserItem" ADD COLUMN     "nickname" TEXT;

-- CreateTable
CREATE TABLE "AvatarSlotTombstone" (
    "userId" TEXT NOT NULL,
    "slot" "ItemSlot" NOT NULL,
    "clearedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvatarSlotTombstone_pkey" PRIMARY KEY ("userId","slot")
);

-- CreateTable
CREATE TABLE "ReviewCard" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "box" INTEGER NOT NULL DEFAULT 1,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastResult" BOOLEAN,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewCard_userId_dueAt_idx" ON "ReviewCard"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCard_userId_lessonId_key" ON "ReviewCard"("userId", "lessonId");

-- AddForeignKey
ALTER TABLE "AvatarSlotTombstone" ADD CONSTRAINT "AvatarSlotTombstone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: an existing pet name belongs to the starter pet it was given with.
UPDATE "UserItem" ui SET "nickname" = u."petName"
FROM "User" u, "Item" i
WHERE ui."userId" = u."id" AND ui."itemId" = i."id"
  AND i."slug" LIKE 'starter-pet-%' AND u."petName" IS NOT NULL;
