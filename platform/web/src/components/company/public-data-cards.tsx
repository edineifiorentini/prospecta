"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Landmark, Loader2, RefreshCw, Scale, Search, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Candidates, Notice, ProfileView, type DataDto } from "./business-data-card";

const settingsLink = (
  <Link href="/configuracoes?tab=integracoes" className="underline underline-offset-2">
    Configurações › Integrações
  </Link>
);
const brl = (v: number | null) => (v == null ? "Não disponível" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));

// ── Cadastro oficial (Receita, base local de dados abertos) ──
type ReceitaView = { enabled: boolean; base: { records: number; lastImport: { finishedAt: string | null } | null } | null; companyCnpj: string | null; data: DataDto | null };

export function ReceitaCard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["receita", companyId], queryFn: () => api<ReceitaView>(`/companies/${companyId}/receita`) });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["receita", companyId] });
    qc.invalidateQueries({ queryKey: ["intelligence", companyId] });
    qc.invalidateQueries({ queryKey: ["company", companyId] });
  };
  const run = useMutation({ mutationFn: () => api<DataDto>(`/companies/${companyId}/receita`, { method: "POST" }), onSuccess: done, onError: (e) => toast.error(errorMessage(e)) });
  const confirm = useMutation({
    mutationFn: (cnpj: string) => api<DataDto>(`/companies/${companyId}/receita/confirm`, { method: "POST", body: { cnpj } }),
    onSuccess: () => {
      toast.success("Empresa confirmada na base da Receita");
      done();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data || !q.data.enabled) return null;
  const v = q.data;
  const d = v.data;
  const busy = run.isPending || confirm.isPending;
  const action = can("enrich:run") && !!v.base?.records && (
    <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={busy}>
      {run.isPending ? <Loader2 className="animate-spin" /> : d ? <RefreshCw /> : <Search />} {d ? "Atualizar" : "Identificar na Receita"}
    </Button>
  );
  return (
    <SectionCard title="Cadastro oficial (Receita Federal, dados abertos)" description="Base local importada dos arquivos oficiais do CNPJ. Vínculo só por CNPJ, telefone ou domínio iguais; semelhança de nome só gera candidatos." actions={action}>
      <div className="grid gap-3">
        {!v.base?.records && <Notice>A base local da Receita está vazia: importe os arquivos da sua UF (platform/docs/FONTES-PUBLICAS.md).</Notice>}
        {!d && !!v.base?.records && <p className="text-sm text-muted-foreground">Ainda não consultado.</p>}
        {d?.status === "CANDIDATES" && (
          <>
            {d.warnings.map((w) => (
              <Notice key={w} tone="warn">
                {w}
              </Notice>
            ))}
            <Candidates candidates={d.candidates} disabled={busy || !can("enrich:run")} onChoose={(c) => confirm.mutate(c)} intro="Encontramos mais de uma possibilidade (ou um vínculo que precisa de conferência). Confirme qual estabelecimento é esta empresa." />
          </>
        )}
        {d?.status === "NOT_FOUND" && <Notice>{d.warnings[0] ?? "Não encontrado no recorte importado."}</Notice>}
        {d?.status === "MATCHED" && d.profile && (
          <>
            <ProfileView data={d} profile={d.profile} registryOnly />
            <p className="text-xs text-muted-foreground">
              Consulta de {fmtDateTime(d.fetchedAt)}
              {v.base?.lastImport?.finishedAt ? ` · base importada em ${fmtDate(v.base.lastImport.finishedAt)}` : ""}
            </p>
          </>
        )}
      </div>
    </SectionCard>
  );
}

// ── Registros públicos (Portal da Transparência) ──
type PublicRecord = { id: string; kind: "CEIS" | "CNEP" | "CONTRATO_FEDERAL"; agency: string | null; recordType: string | null; description: string | null; status: string | null; startDate: string | null; endDate: string | null; value: number | null; url: string | null; fetchedAt: string };
type RecordsView = { enabled: boolean; configured: boolean; simulated: boolean; credentialUrl?: string; companyCnpj: string | null; records: PublicRecord[]; lastRun: { createdAt: string; ok: boolean; errorCode: string | null; mock: boolean } | null };
const KIND_LABEL: Record<PublicRecord["kind"], string> = { CEIS: "CEIS (inidôneas e suspensas)", CNEP: "CNEP (empresas punidas)", CONTRATO_FEDERAL: "Contrato com o governo federal" };

export function PublicRecordsCard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["public-records", companyId], queryFn: () => api<RecordsView>(`/companies/${companyId}/public-records`) });
  const run = useMutation({
    mutationFn: () => api(`/companies/${companyId}/public-records`, { method: "POST", body: { force: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["public-records", companyId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data || !q.data.enabled) return null;
  const v = q.data;
  const sanctions = v.records.filter((r) => r.kind !== "CONTRATO_FEDERAL");
  const contracts = v.records.filter((r) => r.kind === "CONTRATO_FEDERAL");
  const checked = v.lastRun?.ok;
  return (
    <SectionCard
      title="Registros públicos (Portal da Transparência)"
      description="Sanções e contratos federais ligados ao CNPJ exato. Informativo: um registro não prova irregularidade atual; confira vigência, órgão e contexto."
      actions={
        can("enrich:run") &&
        v.companyCnpj &&
        v.configured && (
          <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <Scale />} {checked ? "Atualizar" : "Consultar"}
          </Button>
        )
      }
    >
      <div className="grid gap-3 text-sm">
        {!v.companyCnpj && <Notice>Sem CNPJ validado: nenhum registro público é vinculado a esta empresa.</Notice>}
        {v.companyCnpj && !v.configured && (
          <Notice>
            Falta a chave gratuita do Portal da Transparência em {settingsLink}.
          </Notice>
        )}
        {v.lastRun && !v.lastRun.ok && <Notice tone="warn">A última consulta falhou ({v.lastRun.errorCode}). Tente de novo mais tarde.</Notice>}
        {checked && !v.records.length && <p className="text-muted-foreground">Nenhum registro encontrado na consulta de {fmtDateTime(v.lastRun!.createdAt)}.</p>}
        {sanctions.length > 0 && (
          <section className="grid gap-1.5">
            <h3 className="text-xs font-semibold">Sanções registradas</h3>
            <ul className="divide-y rounded-md border">
              {sanctions.map((r) => (
                <li key={r.id} className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.recordType ?? KIND_LABEL[r.kind]}</span>
                    <Badge variant="outline" className="text-[10px]">{r.kind}</Badge>
                    {r.status && <Badge variant={r.status === "vigente" ? "secondary" : "outline"} className="text-[10px]">{r.status}</Badge>}
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {r.agency ?? "Órgão não informado"} · de {fmtDate(r.startDate)} até {r.endDate ? fmtDate(r.endDate) : "sem data de término"}
                    {r.value != null ? ` · multa ${brl(r.value)}` : ""}
                    {r.description ? ` · ${r.description}` : ""}
                  </div>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      Publicação oficial
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {contracts.length > 0 && (
          <section className="grid gap-1.5">
            <h3 className="text-xs font-semibold">Contratos com o governo federal ({contracts.length})</h3>
            <ul className="divide-y rounded-md border">
              {contracts.map((r) => (
                <li key={r.id} className="px-3 py-2 text-xs">
                  <div className="font-medium">{r.description ?? "Contrato"}</div>
                  <div className="text-muted-foreground">
                    {r.agency ?? "Órgão não informado"} · {r.status ?? "situação não informada"} · vigência {fmtDate(r.startDate)} a {fmtDate(r.endDate)} · valor {brl(r.value)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {v.simulated && <p className="text-[11px] text-muted-foreground">Modo simulado: registros de teste.</p>}
      </div>
    </SectionCard>
  );
}

// ── CVM (companhias abertas) ──
type CvmView = { enabled: boolean; hasCnpj: boolean; data: { company: { name: string; status: string | null; sector: string | null; cvmCode: string | null }; years: { year: number; consolidated: boolean; referenceDate: string; items: { statement: string; accountCode: string; accountName: string; valueBrl: number }[] }[] } | null };

export function CvmCard({ companyId }: { companyId: string }) {
  const q = useQuery({ queryKey: ["cvm", companyId], queryFn: () => api<CvmView>(`/companies/${companyId}/cvm`) });
  if (!q.data?.enabled || !q.data.data) return null;
  const { company, years } = q.data.data;
  const accounts = [...new Map(years.flatMap((y) => y.items.map((i) => [i.accountCode, i.accountName] as const))).entries()];
  return (
    <SectionCard title="Demonstrações financeiras (CVM)" description={`${company.name}${company.sector ? ` · ${company.sector}` : ""} · companhia aberta${company.status ? ` (${company.status})` : ""}. Valores publicados nas DFP.`}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3 font-normal">Conta</th>
              {years.map((y) => (
                <th key={y.year} className="py-1 pr-3 text-right font-normal">
                  {y.year}
                  {y.consolidated ? "" : " (individual)"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map(([code, name]) => (
              <tr key={code} className="border-t">
                <td className="py-1 pr-3">{name}</td>
                {years.map((y) => {
                  const it = y.items.find((i) => i.accountCode === code);
                  return (
                    <td key={y.year} className="py-1 pr-3 text-right num">
                      {it ? brl(it.valueBrl) : "Não disponível"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ── Aderência por oferta ──
type OfferScore = { id: string; name: string; priority: "A" | "B" | "C" | "NEEDS_QUALIFICATION"; composite: number | null; fit: number | null; opportunity: number | null; reliability: number | null; reasons: string[]; highlights: { key: string; label: string; result: string; justification: string }[] };
const PRIORITY: Record<OfferScore["priority"], string> = { A: "Prioridade A", B: "Prioridade B", C: "Prioridade C", NEEDS_QUALIFICATION: "Necessita qualificação" };

export function OffersCard({ companyId }: { companyId: string }) {
  const q = useQuery({ queryKey: ["offers", companyId], queryFn: () => api<{ offers: OfferScore[] }>(`/companies/${companyId}/offers`) });
  if (!q.data?.offers.length) return null;
  return (
    <SectionCard title="Aderência por oferta" description="As mesmas evidências pontuadas com os pesos de cada produto ou serviço (Configurações › Ofertas).">
      <ul className="grid gap-3">
        {q.data.offers.map((o) => (
          <li key={o.id} className="rounded-md border px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Target className="size-4 text-muted-foreground" />
              <span className="font-medium">{o.name}</span>
              <Badge variant={o.priority === "A" ? "default" : "secondary"}>{PRIORITY[o.priority]}</Badge>
              <span className="text-xs text-muted-foreground">
                aderência {o.fit ?? "—"} · oportunidade {o.opportunity ?? "—"} · confiabilidade {o.reliability ?? "—"}
                {o.composite != null ? ` · média ${o.composite}` : ""}
              </span>
            </div>
            {o.highlights.length > 0 && (
              <ul className="mt-1.5 grid gap-0.5 text-xs text-muted-foreground">
                {o.highlights.map((h) => (
                  <li key={h.key}>
                    {h.label}: {h.justification}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ── Indicadores regionais (aba própria) ──
type Indicator = { key: string; label: string; value: number | null; status: string; unit: string; referenceYear: string | null; table: string; note: string };
type Sector = { section: string; name: string; localUnits: number | null; employed: number | null };
type Flow = { flow: "export" | "import"; years: { year: string; fob: number; kg: number; partial: boolean }[]; ytd: { year: string; months: number; fob: number; previousFob: number; changePct: number | null } | null; topProducts: { code: string; name: string; fob: number }[]; topCountries: { name: string; fob: number }[] };
type Labor = { available: boolean; periods: string[]; monthly: { period: string; hires: number; separations: number; balance: number }[]; bySection: { section: string; name: string; hires: number; separations: number; balance: number }[]; highlight: { section: string; name: string; balance: number } | null };
type Regional = {
  simulated: boolean;
  city: { ibge: string; name: string; uf: string } | null;
  reason: string | null;
  highlightSection: string | null;
  ibge: { enabled: boolean; data: { indicators: Indicator[]; sectors: Sector[]; sectorsYear: string | null } | null; error: string | null; fetchedAt: string | null };
  comex: { enabled: boolean; data: { updatedUntil: string; flows: Flow[] } | null; error: string | null; fetchedAt: string | null };
  caged: { enabled: boolean; data: Labor | null; error: string | null };
};
const usd = (v: number) => (v >= 1_000_000 ? `US$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : `US$ ${fmtNumber(Math.round(v))}`);
const STATUS_TEXT: Record<string, string> = { sigilo: "Não divulgado (sigilo estatístico)", indisponivel: "Não disponível" };
const period = (p: string) => `${p.slice(4)}/${p.slice(0, 4)}`;

export function RegionalPanel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["regional", companyId], queryFn: () => api<Regional>(`/companies/${companyId}/regional`) });
  const refresh = useMutation({
    mutationFn: () => api<Regional>(`/companies/${companyId}/regional?force=true`),
    onSuccess: (r) => qc.setQueryData(["regional", companyId], r),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando indicadores do município…</p>;
  if (!q.data) return null;
  const r = q.data;
  if (!r.ibge.enabled && !r.comex.enabled && !r.caged.enabled)
    return (
      <SectionCard title="Indicadores regionais">
        <p className="text-sm text-muted-foreground">Nenhuma fonte regional ligada. Ative IBGE, Comex Stat ou CAGED em {settingsLink}.</p>
      </SectionCard>
    );
  return (
    <div className="grid gap-6">
      <SectionCard
        title={r.city ? `Indicadores de ${r.city.name}/${r.city.uf}` : "Indicadores regionais"}
        description="Estatísticas do MUNICÍPIO, com ano de referência e fonte. Não descrevem esta empresa nem são atribuídas a ela."
        actions={
          r.city && (
            <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Atualizar
            </Button>
          )
        }
      >
        <div className="grid gap-2 text-sm">
          {r.reason && <Notice>{r.reason}</Notice>}
          {r.simulated && <p className="text-[11px] text-muted-foreground">Modo simulado: números de teste.</p>}
        </div>
      </SectionCard>

      {r.ibge.enabled && r.city && (
        <SectionCard title="Economia e empresas do município (IBGE)" description={r.ibge.fetchedAt ? `Consultado em ${fmtDate(r.ibge.fetchedAt)}` : undefined}>
          {r.ibge.error && <Notice tone="warn">{r.ibge.error}</Notice>}
          {r.ibge.data && (
            <div className="grid gap-5">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {r.ibge.data.indicators.map((i) => (
                  <div key={i.key} className="rounded-md border px-3 py-2" title={i.note}>
                    <dt className="text-xs text-muted-foreground">{i.label}</dt>
                    <dd className="text-lg font-semibold num">{i.value != null ? `${fmtNumber(i.value)} ${i.unit === "pessoas" || i.unit === "unidades" ? "" : i.unit}`.trim() : <span className="text-sm font-normal text-muted-foreground">{STATUS_TEXT[i.status] ?? "Não disponível"}</span>}</dd>
                    <dd className="text-[11px] text-muted-foreground">
                      {i.referenceYear ? `ano ${i.referenceYear}` : "ano não informado"} · tabela {i.table}
                    </dd>
                  </div>
                ))}
              </dl>
              {r.ibge.data.sectors.length > 0 && (
                <section className="grid gap-1.5">
                  <h3 className="text-sm font-semibold">Unidades locais e pessoal ocupado por setor (CEMPRE {r.ibge.data.sectorsYear ?? ""})</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 pr-3 font-normal">Seção CNAE</th>
                          <th className="py-1 pr-3 text-right font-normal">Unidades locais</th>
                          <th className="py-1 text-right font-normal">Pessoal ocupado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.ibge.data.sectors.map((s) => (
                          <tr key={s.section} className={s.section === r.highlightSection ? "border-t bg-accent/40 font-medium" : "border-t"}>
                            <td className="py-1 pr-3">
                              {s.section} · {s.name}
                              {s.section === r.highlightSection ? " (setor desta empresa)" : ""}
                            </td>
                            <td className="py-1 pr-3 text-right num">{s.localUnits != null ? fmtNumber(s.localUnits) : "Não disponível"}</td>
                            <td className="py-1 text-right num">{s.employed != null ? fmtNumber(s.employed) : "Não disponível"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </SectionCard>
      )}

      {r.comex.enabled && r.city && (
        <SectionCard title="Comércio exterior do município (Comex Stat)" description="Valor FOB em dólares, pelo domicílio fiscal de quem declarou. Não indica que esta empresa exporta ou importa.">
          {r.comex.error && <Notice tone="warn">{r.comex.error}</Notice>}
          {r.comex.data && (
            <div className="grid gap-4 lg:grid-cols-2">
              {r.comex.data.flows.map((f) => (
                <section key={f.flow} className="grid content-start gap-1.5 text-xs">
                  <h3 className="text-sm font-semibold">{f.flow === "export" ? "Exportações" : "Importações"}</h3>
                  {!f.years.length ? (
                    <p className="text-muted-foreground">Sem registros no período.</p>
                  ) : (
                    <>
                      <p>
                        {f.years.map((y) => `${y.year}${y.partial ? " (parcial)" : ""}: ${usd(y.fob)}`).join(" · ")}
                      </p>
                      {f.ytd && f.ytd.changePct != null && (
                        <p className="text-muted-foreground">
                          Acumulado até o mês {f.ytd.months}: {f.ytd.changePct > 0 ? "+" : ""}
                          {f.ytd.changePct.toLocaleString("pt-BR")}% em relação ao mesmo período do ano anterior.
                        </p>
                      )}
                      {f.topProducts.length > 0 && <p>Principais produtos: {f.topProducts.slice(0, 3).map((p) => p.name).join("; ")}</p>}
                      {f.topCountries.length > 0 && <p>Principais países: {f.topCountries.slice(0, 3).map((c) => c.name).join(", ")}</p>}
                    </>
                  )}
                </section>
              ))}
              <p className="text-[11px] text-muted-foreground lg:col-span-2">Dados até {r.comex.data.updatedUntil}.</p>
            </div>
          )}
        </SectionCard>
      )}

      {r.caged.enabled && r.city && (
        <SectionCard title="Emprego formal no município (Novo CAGED)" description="Admissões e desligamentos de carteira assinada nos últimos meses importados. Tendência do setor na cidade, não o quadro de nenhuma empresa.">
          {!r.caged.data?.available ? (
            <p className="text-sm text-muted-foreground">Não disponível: os microdados do CAGED deste município ainda não foram importados.</p>
          ) : (
            <div className="grid gap-3 text-xs">
              <p>
                {r.caged.data.periods.length} mês(es), de {period(r.caged.data.periods[0]!)} a {period(r.caged.data.periods.at(-1)!)} · saldo total {fmtNumber(r.caged.data.monthly.reduce((s, m) => s + m.balance, 0))}
              </p>
              {r.caged.data.highlight && (
                <p className="font-medium">
                  Setor desta empresa ({r.caged.data.highlight.section} · {r.caged.data.highlight.name}): saldo de {fmtNumber(r.caged.data.highlight.balance)} vaga(s) no período.
                </p>
              )}
              <p className="text-muted-foreground">
                Setores que mais cresceram: {r.caged.data.bySection.slice(0, 3).map((s) => `${s.name} (${s.balance > 0 ? "+" : ""}${fmtNumber(s.balance)})`).join("; ")}
              </p>
            </div>
          )}
        </SectionCard>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Landmark className="size-3.5" /> Fontes oficiais: IBGE (API de agregados), MDIC (Comex Stat) e MTE (Novo CAGED).
      </p>
    </div>
  );
}
