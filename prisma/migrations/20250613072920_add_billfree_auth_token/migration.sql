-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "billFreeAuthToken" TEXT,
ADD COLUMN     "isBillFreeConfigured" BOOLEAN NOT NULL DEFAULT false;
