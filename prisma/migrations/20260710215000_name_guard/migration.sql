-- AlterTable
ALTER TABLE "GroupSettings"
ADD COLUMN "nameProtectionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "nameProtectionMessage" TEXT NOT NULL DEFAULT 'Dieser Name ist in unserer Gruppe nicht erlaubt. Ändere deinen Namen und versuche es erneut.';

-- CreateTable
CREATE TABLE "ForbiddenName" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "normalizedPattern" TEXT NOT NULL,
    "compactPattern" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByTelegramId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ForbiddenName_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForbiddenName_groupId_normalizedPattern_key" ON "ForbiddenName"("groupId", "normalizedPattern");

-- CreateIndex
CREATE INDEX "ForbiddenName_groupId_enabled_deletedAt_idx" ON "ForbiddenName"("groupId", "enabled", "deletedAt");

-- AddForeignKey
ALTER TABLE "ForbiddenName" ADD CONSTRAINT "ForbiddenName_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
