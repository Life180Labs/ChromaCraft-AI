-- ChromaCraft-AI: Gemini-First Schema Migration
-- Applies incrementally without data loss

-- 1. Add new GenerationStrategy enum values (Postgres only allows ADD, not remove mid-migration)
ALTER TYPE "GenerationStrategy" ADD VALUE IF NOT EXISTS 'GEMINI_IMAGE_EDIT';
ALTER TYPE "GenerationStrategy" ADD VALUE IF NOT EXISTS 'GEMINI_LIFESTYLE';
ALTER TYPE "GenerationStrategy" ADD VALUE IF NOT EXISTS 'VEO_VIDEO';
ALTER TYPE "GenerationStrategy" ADD VALUE IF NOT EXISTS 'GEMINI_SPIN';
ALTER TYPE "GenerationStrategy" ADD VALUE IF NOT EXISTS 'HUE_SHIFT';

-- 2. Migrate existing STABILITY_SEARCH_REPLACE rows to GEMINI_IMAGE_EDIT
UPDATE "GenerationConfig" SET strategy = 'GEMINI_IMAGE_EDIT' WHERE strategy = 'STABILITY_SEARCH_REPLACE';
UPDATE "GenerationConfig" SET strategy = 'GEMINI_IMAGE_EDIT' WHERE strategy = 'SDXL_CONTROLNET';
UPDATE "GenerationConfig" SET strategy = 'GEMINI_IMAGE_EDIT' WHERE strategy = 'FLUX_REDUX';
UPDATE "GenerationConfig" SET strategy = 'GEMINI_IMAGE_EDIT' WHERE strategy = 'GPT_IMAGE_EDIT';

-- 3. Add new columns to GenerationConfig
ALTER TABLE "GenerationConfig"
  ADD COLUMN IF NOT EXISTS "geminiImageModel" TEXT NOT NULL DEFAULT 'gemini-2.0-flash-preview-image-generation',
  ADD COLUMN IF NOT EXISTS "geminiVideoModel" TEXT NOT NULL DEFAULT 'veo-2.0-generate-001',
  ADD COLUMN IF NOT EXISTS "videoEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "videoPrompt" TEXT,
  ADD COLUMN IF NOT EXISTS "spinEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fps" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "cropsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "lifestyleEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "filesApiUri" TEXT,
  ADD COLUMN IF NOT EXISTS "filesApiExpiry" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- 4. Remove old Stability AI columns (safe — they are no longer used)
ALTER TABLE "GenerationConfig"
  DROP COLUMN IF EXISTS "denoiseStrength",
  DROP COLUMN IF EXISTS "controlNetEnabled",
  DROP COLUMN IF EXISTS "identityLock",
  DROP COLUMN IF EXISTS "seed",
  DROP COLUMN IF EXISTS "qualityThreshold";

-- 5. Add new JobType VIDEO_GENERATION
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'VIDEO_GENERATION';

-- 6. Add missing database indexes for query performance
CREATE INDEX IF NOT EXISTS "Asset_jobId_idx" ON "Asset"("jobId");
CREATE INDEX IF NOT EXISTS "Asset_jobId_type_idx" ON "Asset"("jobId", "type");
CREATE INDEX IF NOT EXISTS "Asset_jobId_type_status_idx" ON "Asset"("jobId", "type", "status");
CREATE INDEX IF NOT EXISTS "Job_userId_idx" ON "Job"("userId");
CREATE INDEX IF NOT EXISTS "Job_status_idx" ON "Job"("status");
CREATE INDEX IF NOT EXISTS "Job_userId_status_idx" ON "Job"("userId", "status");
CREATE INDEX IF NOT EXISTS "JobEvent_jobId_idx" ON "JobEvent"("jobId");

-- 7. Create AppSettings singleton table
CREATE TABLE IF NOT EXISTS "AppSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "geminiImageModel" TEXT NOT NULL DEFAULT 'gemini-2.0-flash-preview-image-generation',
  "geminiVideoModel" TEXT NOT NULL DEFAULT 'veo-2.0-generate-001',
  "defaultGridCols" INTEGER NOT NULL DEFAULT 4,
  "defaultGridRows" INTEGER NOT NULL DEFAULT 3,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- Insert default settings row if not present
INSERT INTO "AppSettings" ("id", "geminiImageModel", "geminiVideoModel", "defaultGridCols", "defaultGridRows", "updatedAt")
VALUES (1, 'gemini-2.0-flash-preview-image-generation', 'veo-2.0-generate-001', 4, 3, NOW())
ON CONFLICT ("id") DO NOTHING;

-- 8. Add status column to Asset if missing (for the 'pending' video state)
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'done';

SELECT 'Migration complete' AS result;
