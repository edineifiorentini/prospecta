-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "status" "AiAnalysisStatus" NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "requested_model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "result" JSONB,
    "edited_message" TEXT,
    "edited_by_id" UUID,
    "edited_at" TIMESTAMP(3),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "cost_usd" DOUBLE PRECISION,
    "cost_basis" TEXT,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "error_code" TEXT,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_analyses_company_id_created_at_idx" ON "ai_analyses"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_analyses_organization_id_created_at_idx" ON "ai_analyses"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_analyses_organization_id_company_id_input_hash_idx" ON "ai_analyses"("organization_id", "company_id", "input_hash");

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

