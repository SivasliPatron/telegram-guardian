-- AlterTable
ALTER TABLE "Filter" ADD COLUMN "learnedKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Filter_groupId_learnedKey_key" ON "Filter"("groupId", "learnedKey");
