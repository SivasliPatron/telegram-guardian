-- AlterTable
ALTER TABLE "GroupSettings"
ADD COLUMN "inactivityCleanupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "inactivityTrackingStartedAt" TIMESTAMP(3),
ADD COLUMN "inactivityLastSweepAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GroupMember"
ADD COLUMN "inactivityWarnedAt" TIMESTAMP(3),
ADD COLUMN "inactivityKickDueAt" TIMESTAMP(3),
ADD COLUMN "inactivityRemovalStartedAt" TIMESTAMP(3),
ADD COLUMN "inactivityBannedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GroupSettings_inactivity_cleanup_sweep_idx"
ON "GroupSettings"("inactivityCleanupEnabled", "inactivityLastSweepAt");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_deletedAt_role_lastSeenAt_idx"
ON "GroupMember"("groupId", "deletedAt", "role", "lastSeenAt");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_inactivityKickDueAt_idx"
ON "GroupMember"("groupId", "inactivityKickDueAt");

-- CreateIndex
CREATE INDEX "GroupMember_inactivityRemovalStartedAt_inactivityBannedAt_idx"
ON "GroupMember"("inactivityRemovalStartedAt", "inactivityBannedAt");
