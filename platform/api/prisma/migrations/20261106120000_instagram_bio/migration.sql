-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'INSTAGRAM';

-- AlterTable
ALTER TABLE "social_profiles" ADD COLUMN     "details" JSONB;
