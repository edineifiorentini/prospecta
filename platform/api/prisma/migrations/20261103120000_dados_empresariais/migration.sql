-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'ECONODATA';

-- CreateTable
CREATE TABLE "company_data_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cnpj" TEXT,
    "match_confidence" DOUBLE PRECISION,
    "matched_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "identified_by" TEXT,
    "profile" JSONB,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buckets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokens_charged" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error" TEXT,
    "fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_data_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_provider_calls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID,
    "requested_by_id" UUID,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "estimate_only" BOOLEAN NOT NULL DEFAULT false,
    "http_status" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "tokens_charged" INTEGER NOT NULL DEFAULT 0,
    "tokens_estimated" INTEGER,
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_provider_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_data_profiles_organization_id_cnpj_idx" ON "company_data_profiles"("organization_id", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "company_data_profiles_organization_id_company_id_provider_key" ON "company_data_profiles"("organization_id", "company_id", "provider");

-- CreateIndex
CREATE INDEX "data_provider_calls_organization_id_created_at_idx" ON "data_provider_calls"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "company_data_profiles" ADD CONSTRAINT "company_data_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_data_profiles" ADD CONSTRAINT "company_data_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_provider_calls" ADD CONSTRAINT "data_provider_calls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

