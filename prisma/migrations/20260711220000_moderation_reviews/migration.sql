-- CreateEnum
CREATE TYPE "ModerationReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'DISMISSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ModerationReview" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reviewedById" TEXT,
    "warningId" TEXT,
    "originalMessageId" BIGINT NOT NULL,
    "reviewMessageId" BIGINT,
    "messageText" TEXT NOT NULL,
    "aiCategory" TEXT NOT NULL,
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "aiReason" TEXT NOT NULL,
    "status" "ModerationReviewStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "enforcedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModerationReview_warningId_key" ON "ModerationReview"("warningId");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationReview_groupId_originalMessageId_key" ON "ModerationReview"("groupId", "originalMessageId");

-- CreateIndex
CREATE INDEX "ModerationReview_groupId_status_expiresAt_idx" ON "ModerationReview"("groupId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ModerationReview_status_expiresAt_idx" ON "ModerationReview"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ModerationReview_targetUserId_createdAt_idx" ON "ModerationReview"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationReview_reviewedById_idx" ON "ModerationReview"("reviewedById");

-- AddForeignKey
ALTER TABLE "ModerationReview" ADD CONSTRAINT "ModerationReview_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReview" ADD CONSTRAINT "ModerationReview_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReview" ADD CONSTRAINT "ModerationReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationReview" ADD CONSTRAINT "ModerationReview_warningId_fkey" FOREIGN KEY ("warningId") REFERENCES "Warning"("id") ON DELETE SET NULL ON UPDATE CASCADE;
