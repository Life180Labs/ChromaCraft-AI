-- AlterTable
ALTER TABLE "Job" ADD COLUMN "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "errorStack" TEXT,
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "storagePrefix" TEXT,
ADD COLUMN "scheduledAt" TIMESTAMP(3),
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

