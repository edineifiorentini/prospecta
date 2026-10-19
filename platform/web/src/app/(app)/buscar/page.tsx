"use client";

import { FileSpreadsheet, Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, SectionCard } from "@/components/page";
import { SearchForm } from "@/components/search/search-form";
import { CsvImport } from "@/components/search/csv-import";
import { JobList } from "@/components/search/job-list";
import { useSession } from "@/lib/session";

export default function FindCompaniesPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Encontrar Empresas"
        description="Pesquise em fontes autorizadas ou importe sua própria planilha. Os resultados são deduplicados e registrados com a origem de cada informação."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <SectionCard>
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
              {can("search:run") ? <SearchForm /> : <p className="text-sm text-muted-foreground">Seu perfil não permite iniciar buscas.</p>}
            </TabsContent>
            <TabsContent value="csv">
              {can("import:run") ? <CsvImport /> : <p className="text-sm text-muted-foreground">Seu perfil não permite importar arquivos.</p>}
            </TabsContent>
          </Tabs>
        </SectionCard>
        <div>
          <h2 className="mb-3 text-sm font-semibold">Buscas e importações recentes</h2>
          <JobList />
        </div>
      </div>
    </>
  );
}
