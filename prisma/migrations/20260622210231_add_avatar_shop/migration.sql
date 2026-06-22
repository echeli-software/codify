-- CreateEnum
CREATE TYPE "ItemSlot" AS ENUM ('PET', 'BACKGROUND', 'TOP', 'BOTTOM', 'SHOES', 'HAT', 'HAIR', 'GLASSES', 'ACCESSORY', 'FRAME', 'EMOTE');

-- CreateEnum
CREATE TYPE "ItemRarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateEnum
CREATE TYPE "ItemAcquisitionSource" AS ENUM ('PURCHASE', 'CHEST', 'ADMIN_GRANT', 'PROMO', 'ONBOARDING', 'REFUND_RESTORE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarConfig" JSONB;

-- CreateTable
CREATE TABLE "ItemCategory" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slot" "ItemSlot" NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "rarity" "ItemRarity" NOT NULL DEFAULT 'COMMON',
    "costCoins" INTEGER NOT NULL DEFAULT 0,
    "requiredLevel" INTEGER NOT NULL DEFAULT 1,
    "isPremiumOnly" BOOLEAN NOT NULL DEFAULT false,
    "isLimitedDrop" BOOLEAN NOT NULL DEFAULT false,
    "dropStartsAt" TIMESTAMP(3),
    "dropEndsAt" TIMESTAMP(3),
    "spriteAssetId" TEXT NOT NULL,
    "thumbnailAssetId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserItem" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v7(),
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "source" "ItemAcquisitionSource" NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquippedItem" (
    "userId" TEXT NOT NULL,
    "slot" "ItemSlot" NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "EquippedItem_pkey" PRIMARY KEY ("userId","slot")
);

-- CreateIndex
CREATE UNIQUE INDEX "Item_slug_key" ON "Item"("slug");

-- CreateIndex
CREATE INDEX "Item_slot_rarity_idx" ON "Item"("slot", "rarity");

-- CreateIndex
CREATE INDEX "Item_dropStartsAt_dropEndsAt_idx" ON "Item"("dropStartsAt", "dropEndsAt");

-- CreateIndex
CREATE INDEX "UserItem_userId_acquiredAt_idx" ON "UserItem"("userId", "acquiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserItem_userId_itemId_key" ON "UserItem"("userId", "itemId");

-- CreateIndex
CREATE INDEX "EquippedItem_userId_idx" ON "EquippedItem"("userId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categorySlug_fkey" FOREIGN KEY ("categorySlug") REFERENCES "ItemCategory"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquippedItem" ADD CONSTRAINT "EquippedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquippedItem" ADD CONSTRAINT "EquippedItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
