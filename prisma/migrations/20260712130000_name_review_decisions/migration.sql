-- Existing entries were installed automatically by the old name-guard setup.
-- Start the learning workflow with no active name rules.
UPDATE "ForbiddenName"
SET
    "enabled" = false,
    "deletedAt" = COALESCE("deletedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "enabled" = true OR "deletedAt" IS NULL;

-- CreateEnum
CREATE TYPE "NameReviewContext" AS ENUM ('JOIN_REQUEST', 'MEMBER');

-- CreateEnum
CREATE TYPE "NameReviewStatus" AS ENUM ('PENDING', 'ALLOWED', 'FORBIDDEN', 'EXPIRED');

-- CreateTable
CREATE TABLE "AllowedName" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByTelegramId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AllowedName_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NameReview" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reviewedById" TEXT,
    "context" "NameReviewContext" NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "candidatePattern" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "requestUserChatId" BIGINT,
    "reviewMessageId" BIGINT,
    "status" "NameReviewStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "enforcedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NameReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllowedName_groupId_normalizedName_key" ON "AllowedName"("groupId", "normalizedName");

-- CreateIndex
CREATE INDEX "AllowedName_groupId_enabled_deletedAt_idx" ON "AllowedName"("groupId", "enabled", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NameReview_groupId_targetUserId_normalizedName_key" ON "NameReview"("groupId", "targetUserId", "normalizedName");

-- CreateIndex
CREATE INDEX "NameReview_groupId_status_expiresAt_idx" ON "NameReview"("groupId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "NameReview_status_expiresAt_idx" ON "NameReview"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "NameReview_targetUserId_createdAt_idx" ON "NameReview"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "NameReview_reviewedById_idx" ON "NameReview"("reviewedById");

-- AddForeignKey
ALTER TABLE "AllowedName" ADD CONSTRAINT "AllowedName_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NameReview" ADD CONSTRAINT "NameReview_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NameReview" ADD CONSTRAINT "NameReview_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NameReview" ADD CONSTRAINT "NameReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
