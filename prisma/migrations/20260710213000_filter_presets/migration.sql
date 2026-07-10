-- AlterTable
ALTER TABLE "Filter" ADD COLUMN "presetKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Filter_groupId_presetKey_key" ON "Filter"("groupId", "presetKey");
