-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InternalRole" AS ENUM ('OWNER', 'ADMIN', 'MODERATOR', 'TRUSTED', 'MEMBER');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('WARN', 'UNWARN', 'CLEAR_WARNINGS', 'MUTE', 'UNMUTE', 'BAN', 'UNBAN', 'KICK', 'DELETE_MESSAGE', 'FLOOD', 'LINK', 'FILTER', 'SETTINGS');

-- CreateEnum
CREATE TYPE "FilterMatchType" AS ENUM ('EXACT', 'CONTAINS', 'REGEX');

-- CreateEnum
CREATE TYPE "FilterActionType" AS ENUM ('DELETE', 'WARN', 'MUTE', 'LOG', 'REPLY');

-- CreateTable
CREATE TABLE "TelegramGroup" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSettings" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'de',
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeBots" BOOLEAN NOT NULL DEFAULT false,
    "welcomeText" TEXT NOT NULL DEFAULT 'Willkommen {name} in {group}!',
    "welcomeRulesButton" BOOLEAN NOT NULL DEFAULT true,
    "welcomeDeleteAfterSec" INTEGER,
    "maxWarnings" INTEGER NOT NULL DEFAULT 3,
    "warningMuteDurationSec" INTEGER NOT NULL DEFAULT 3600,
    "floodEnabled" BOOLEAN NOT NULL DEFAULT true,
    "floodMaxMessages" INTEGER NOT NULL DEFAULT 6,
    "floodWindowSec" INTEGER NOT NULL DEFAULT 5,
    "floodMuteDurationSec" INTEGER NOT NULL DEFAULT 600,
    "floodExemptAdmins" BOOLEAN NOT NULL DEFAULT true,
    "floodExemptTrusted" BOOLEAN NOT NULL DEFAULT true,
    "linkProtectionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "blockTelegramLinks" BOOLEAN NOT NULL DEFAULT true,
    "blockExternalLinks" BOOLEAN NOT NULL DEFAULT true,
    "blockShortLinks" BOOLEAN NOT NULL DEFAULT true,
    "blockUsernameAds" BOOLEAN NOT NULL DEFAULT false,
    "blockForwardedChannels" BOOLEAN NOT NULL DEFAULT true,
    "blockPhoneNumbers" BOOLEAN NOT NULL DEFAULT false,
    "blockEmailAddresses" BOOLEAN NOT NULL DEFAULT false,
    "rulesText" TEXT NOT NULL DEFAULT 'Für diese Gruppe wurden noch keine Regeln hinterlegt.',
    "nightModeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "nightCloseTime" TEXT NOT NULL DEFAULT '00:00',
    "nightOpenTime" TEXT NOT NULL DEFAULT '12:00',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "nightClosed" BOOLEAN NOT NULL DEFAULT false,
    "lastNightActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "username" TEXT,
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "InternalRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mutedUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warning" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "originalMessageId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Warning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "moderatorId" TEXT,
    "type" "ModerationActionType" NOT NULL,
    "reason" TEXT,
    "durationSeconds" INTEGER,
    "originalMessageId" BIGINT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Filter" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "matchType" "FilterMatchType" NOT NULL,
    "action" "FilterActionType" NOT NULL,
    "ignoreCase" BOOLEAN NOT NULL DEFAULT true,
    "muteDurationSeconds" INTEGER,
    "responseText" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByTelegramId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Filter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowedDomain" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedUser" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleteAfterSeconds" INTEGER,
    "lastSentAt" TIMESTAMP(3),
    "createdByTelegramId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLogConfiguration" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "channelTelegramId" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminLogConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomCommand" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "buttons" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByTelegramId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedUpdate" (
    "updateId" BIGINT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedUpdate_pkey" PRIMARY KEY ("updateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGroup_telegramId_key" ON "TelegramGroup"("telegramId");

-- CreateIndex
CREATE INDEX "TelegramGroup_isActive_idx" ON "TelegramGroup"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSettings_groupId_key" ON "GroupSettings"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_role_idx" ON "GroupMember"("groupId", "role");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "Warning_groupId_userId_clearedAt_idx" ON "Warning"("groupId", "userId", "clearedAt");

-- CreateIndex
CREATE INDEX "Warning_moderatorId_idx" ON "Warning"("moderatorId");

-- CreateIndex
CREATE INDEX "ModerationAction_groupId_createdAt_idx" ON "ModerationAction"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_targetUserId_createdAt_idx" ON "ModerationAction"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_moderatorId_idx" ON "ModerationAction"("moderatorId");

-- CreateIndex
CREATE INDEX "Filter_groupId_enabled_deletedAt_idx" ON "Filter"("groupId", "enabled", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedDomain_groupId_domain_key" ON "AllowedDomain"("groupId", "domain");

-- CreateIndex
CREATE INDEX "TrustedUser_userId_idx" ON "TrustedUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedUser_groupId_userId_key" ON "TrustedUser"("groupId", "userId");

-- CreateIndex
CREATE INDEX "ScheduledMessage_groupId_active_deletedAt_idx" ON "ScheduledMessage"("groupId", "active", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminLogConfiguration_groupId_key" ON "AdminLogConfiguration"("groupId");

-- CreateIndex
CREATE INDEX "CustomCommand_groupId_enabled_deletedAt_idx" ON "CustomCommand"("groupId", "enabled", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomCommand_groupId_command_key" ON "CustomCommand"("groupId", "command");

-- CreateIndex
CREATE INDEX "ProcessedUpdate_processedAt_idx" ON "ProcessedUpdate"("processedAt");

-- AddForeignKey
ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Filter" ADD CONSTRAINT "Filter_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowedDomain" ADD CONSTRAINT "AllowedDomain_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedUser" ADD CONSTRAINT "TrustedUser_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedUser" ADD CONSTRAINT "TrustedUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedUser" ADD CONSTRAINT "TrustedUser_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLogConfiguration" ADD CONSTRAINT "AdminLogConfiguration_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomCommand" ADD CONSTRAINT "CustomCommand_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
