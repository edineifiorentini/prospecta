-- AlterTable
ALTER TABLE "digital_audits" ADD COLUMN     "diagnostics" JSONB;

-- CreateTable
CREATE TABLE "public_data_cache" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reference_period" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_data_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "company_id" UUID,
    "source" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "http_status" INTEGER,
    "records" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_import_runs" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "file_size" BIGINT,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "lines_read" INTEGER NOT NULL DEFAULT 0,
    "lines_imported" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "public_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_opportunities" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'pncp',
    "control_number" TEXT NOT NULL,
    "buyer_cnpj" TEXT,
    "buyer_name" TEXT,
    "unit_name" TEXT,
    "uf" TEXT,
    "city" TEXT,
    "city_ibge" TEXT,
    "modality_id" INTEGER,
    "modality" TEXT,
    "object" TEXT NOT NULL,
    "object_folded" TEXT NOT NULL,
    "estimated_value" DOUBLE PRECISION,
    "status" TEXT,
    "published_at" TIMESTAMP(3),
    "proposal_opens_at" TIMESTAMP(3),
    "proposal_closes_at" TIMESTAMP(3),
    "url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_public_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "agency" TEXT,
    "record_type" TEXT,
    "description" TEXT,
    "status" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "value" DOUBLE PRECISION,
    "url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_public_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rf_empresas" (
    "cnpj_basico" CHAR(8) NOT NULL,
    "razao_social" TEXT NOT NULL,
    "natureza_juridica" TEXT,
    "capital_social" DOUBLE PRECISION,
    "porte" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rf_empresas_pkey" PRIMARY KEY ("cnpj_basico")
);

-- CreateTable
CREATE TABLE "rf_estabelecimentos" (
    "cnpj" CHAR(14) NOT NULL,
    "cnpj_basico" CHAR(8) NOT NULL,
    "matriz_filial" TEXT,
    "nome_fantasia" TEXT,
    "nome_folded" TEXT,
    "situacao" TEXT,
    "data_situacao" DATE,
    "motivo_situacao" TEXT,
    "data_inicio" DATE,
    "cnae_principal" TEXT,
    "cnaes_secundarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cep" TEXT,
    "uf" TEXT,
    "municipio_codigo" TEXT,
    "telefones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email_dominio" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rf_estabelecimentos_pkey" PRIMARY KEY ("cnpj")
);

-- CreateTable
CREATE TABLE "rf_socios_resumo" (
    "cnpj_basico" CHAR(8) NOT NULL,
    "quantidade" INTEGER NOT NULL,

    CONSTRAINT "rf_socios_resumo_pkey" PRIMARY KEY ("cnpj_basico")
);

-- CreateTable
CREATE TABLE "rf_codigos" (
    "tipo" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,

    CONSTRAINT "rf_codigos_pkey" PRIMARY KEY ("tipo","codigo")
);

-- CreateTable
CREATE TABLE "labor_stats" (
    "id" UUID NOT NULL,
    "source_file" TEXT NOT NULL,
    "period" CHAR(6) NOT NULL,
    "city_code" CHAR(6) NOT NULL,
    "section" TEXT NOT NULL,
    "hires" INTEGER NOT NULL DEFAULT 0,
    "separations" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "labor_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cvm_companies" (
    "cnpj" CHAR(14) NOT NULL,
    "name" TEXT NOT NULL,
    "trade_name" TEXT,
    "status" TEXT,
    "sector" TEXT,
    "cvm_code" TEXT,
    "registered_at" DATE,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cvm_companies_pkey" PRIMARY KEY ("cnpj")
);

-- CreateTable
CREATE TABLE "cvm_financials" (
    "id" UUID NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "year" INTEGER NOT NULL,
    "statement" TEXT NOT NULL,
    "consolidated" BOOLEAN NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "scale" TEXT NOT NULL,
    "reference_date" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cvm_financials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_data_cache_source_key_key" ON "public_data_cache"("source", "key");

-- CreateIndex
CREATE INDEX "integration_runs_source_created_at_idx" ON "integration_runs"("source", "created_at");

-- CreateIndex
CREATE INDEX "integration_runs_organization_id_source_created_at_idx" ON "integration_runs"("organization_id", "source", "created_at");

-- CreateIndex
CREATE INDEX "integration_runs_company_id_source_idx" ON "integration_runs"("company_id", "source");

-- CreateIndex
CREATE INDEX "public_import_runs_source_kind_file_idx" ON "public_import_runs"("source", "kind", "file");

-- CreateIndex
CREATE INDEX "public_opportunities_uf_proposal_closes_at_idx" ON "public_opportunities"("uf", "proposal_closes_at");

-- CreateIndex
CREATE INDEX "public_opportunities_city_ibge_published_at_idx" ON "public_opportunities"("city_ibge", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "public_opportunities_source_control_number_key" ON "public_opportunities"("source", "control_number");

-- CreateIndex
CREATE INDEX "company_public_records_company_id_idx" ON "company_public_records"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_public_records_organization_id_company_id_source_ki_key" ON "company_public_records"("organization_id", "company_id", "source", "kind", "external_id");

-- CreateIndex
CREATE INDEX "rf_estabelecimentos_cnpj_basico_idx" ON "rf_estabelecimentos"("cnpj_basico");

-- CreateIndex
CREATE INDEX "rf_estabelecimentos_uf_municipio_codigo_idx" ON "rf_estabelecimentos"("uf", "municipio_codigo");

-- CreateIndex
CREATE INDEX "rf_estabelecimentos_cep_idx" ON "rf_estabelecimentos"("cep");

-- CreateIndex
CREATE INDEX "rf_estabelecimentos_email_dominio_idx" ON "rf_estabelecimentos"("email_dominio");

-- CreateIndex
CREATE INDEX "rf_estabelecimentos_telefones_idx" ON "rf_estabelecimentos" USING GIN ("telefones");

-- CreateIndex
CREATE INDEX "labor_stats_city_code_period_idx" ON "labor_stats"("city_code", "period");

-- CreateIndex
CREATE UNIQUE INDEX "labor_stats_source_file_period_city_code_section_key" ON "labor_stats"("source_file", "period", "city_code", "section");

-- CreateIndex
CREATE INDEX "cvm_financials_cnpj_idx" ON "cvm_financials"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "cvm_financials_cnpj_year_statement_consolidated_account_cod_key" ON "cvm_financials"("cnpj", "year", "statement", "consolidated", "account_code");

-- AddForeignKey
ALTER TABLE "company_public_records" ADD CONSTRAINT "company_public_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_public_records" ADD CONSTRAINT "company_public_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
