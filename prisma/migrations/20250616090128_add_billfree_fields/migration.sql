-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "billFreeWorkflowId" TEXT,
ADD COLUMN     "fieldMappings" JSONB,
ADD COLUMN     "isBillFreeWorkflowEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");
