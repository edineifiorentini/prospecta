"use client";

import { useState } from "react";
import { FileSpreadsheet, Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, SectionCard } from "@/components/page";
import { SearchForm, type AreaPreview } from "@/components/search/search-form";
import { CsvImport } from "@/components/search/csv-import";
import { JobList } from "@/components/search/job-list";
import { LeadMap } from "@/components/map/lead-map";
import { useSession } from "@/lib/session";

export default function FindCompaniesPage() {
  const { can } = useSession();
  const [preview, setPreview] = useState<AreaPreview>({ area: null, message: "Informe a cidade para ver a área da busca no mapa." });
  return (
    <>
      <PageHeader
        title="Encontrar Empresas"
        description="Pesquise em fontes autorizadas ou importe sua própria planilha. Os resultados são deduplicados e registrados com a origem de cada informação."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <SectionCard tour="search-form">
          <Tabs defaultValue="search">
            <TabsList className="mb-5">
              <TabsTrigger value="search">
                <Search /> Nova busca
              </TabsTrigger>
              <TabsTrigger value="csv">
                <FileSpreadsheet /> Importar CSV
              </TabsTrigger>
            </TabsList>
            <TabsContent value="search">
              {can("search:run") ? <SearchForm onAreaChange={setPreview} /> : <p className="text-sm text-muted-foreground">Seu perfil não permite iniciar buscas.</p>}
            </TabsContent>
            <TabsContent value="csv">
              {can("import:run") ? <CsvImport /> : <p className="text-sm text-muted-foreground">Seu perfil não permite importar arquivos.</p>}
            </TabsContent>
          </Tabs>
        </SectionCard>
        <div className="grid content-start gap-6">
          <section aria-labelledby="area-title" data-tour="search-map">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="area-title" className="text-sm font-semibold">
                Área da busca
              </h2>
              {preview.area && (
                <span className="truncate text-xs text-muted-foreground">
                  {preview.area.label} · raio de {preview.area.radiusKm.toLocaleString("pt-BR")} km
                </span>
              )}
            </div>
            <LeadMap area={preview.area} overlay={preview.area ? null : preview.message} className="h-72 xl:h-80" label="Mapa com o local e o raio da busca" />
          </section>
          <div data-tour="search-jobs">
            <h2 className="mb-3 text-sm font-semibold">Buscas e importações recentes</h2>
            <JobList />
          </div>
        </div>
      </div>
    </>
  );
}
