"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import type { CompanyList } from "@/lib/types";

export default function ListsPage() {
  const q = useQuery({ queryKey: ["lists"], queryFn: () => api<CompanyList[]>("/lists") });
  return (
    <>
      <PageHeader title="Minhas Listas" description="Agrupe empresas para campanhas, territórios ou análises. Uma empresa pode estar em várias listas." />
      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={ListChecks} title="Nenhuma lista ainda" description="Selecione empresas nos resultados de busca ou na página Empresas e use “Salvar em lista”." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((l) => (
            <li key={l.id}>
              <Link href={`/listas/${l.id}`} className="card-soft block p-5 transition-shadow hover:shadow-[var(--shadow-float)]">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-medium">{l.name}</h2>
                  <span className="num rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">{l.count}</span>
                </div>
                {l.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{l.description}</p>}
                <p className="mt-3 text-xs text-muted-foreground">Atualizada {fmtRelative(l.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
