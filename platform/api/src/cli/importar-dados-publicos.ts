/**
 * Importa arquivos públicos já baixados (Receita, Novo CAGED, CVM) para a base local, em streaming e com checkpoint.
 * Nada é baixado automaticamente: veja platform/docs/FONTES-PUBLICAS.md para onde obter cada arquivo.
 *
 *   npm run cli:dados-publicos -- receita --tipo estabelecimentos --arquivo <arquivo> --uf PR [--municipio 7691] [--refazer]
 *   npm run cli:dados-publicos -- receita --tipo empresas|socios|cnaes|naturezas|municipios|motivos --arquivo <arquivo>
 *   npm run cli:dados-publicos -- receita --limpar-socios
 *   npm run cli:dados-publicos -- caged --arquivo CAGEDMOV202509.txt [--uf PR] [--municipio 4128104] [--codificacao latin1] [--refazer]
 *   npm run cli:dados-publicos -- cvm --tipo cadastro|dfp --arquivo <arquivo> [--refazer]
 *   npm run cli:dados-publicos -- status
 *
 * Ctrl+C interrompe com segurança: a próxima execução com o mesmo arquivo e filtros continua de onde parou.
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { env } from "../config/env.ts";
import { prisma } from "../lib/prisma.ts";
import { importCaged } from "../modules/public-data/importers/caged.ts";
import { importCvmCadastro, importCvmDfp } from "../modules/public-data/importers/cvm.ts";
import { importReceita, RECEITA_KINDS, type ReceitaKind } from "../modules/public-data/importers/receita.ts";
import type { ImportResult } from "../modules/public-data/importers/runner.ts";

const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ${m}`);

function fileOf(raw: string | undefined) {
  if (!raw) throw new Error("Informe --arquivo.");
  const path = isAbsolute(raw) ? raw : resolve(env.PUBLIC_DATA_DIR, raw);
  if (!existsSync(path)) throw new Error(`Arquivo não encontrado: ${path}`);
  return path;
}

function report(r: ImportResult) {
  const status = { COMPLETED: "concluída", FAILED: "falhou", CANCELLED: "interrompida", SKIPPED: "já importado (nada feito)" }[r.status];
  log(`importação ${status}: ${r.linesRead.toLocaleString("pt-BR")} linhas lidas, ${r.linesImported.toLocaleString("pt-BR")} aproveitadas${r.resumedFrom ? `, retomada depois da linha ${r.resumedFrom.toLocaleString("pt-BR")}` : ""}${r.error ? `. Erro: ${r.error}` : ""}`);
  if (r.status === "FAILED") process.exitCode = 1;
}

async function main() {
  const [command] = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const { values } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: { tipo: { type: "string" }, arquivo: { type: "string" }, uf: { type: "string" }, municipio: { type: "string" }, codificacao: { type: "string" }, refazer: { type: "boolean" }, "limpar-socios": { type: "boolean" } },
  });
  const ctrl = new AbortController();
  process.once("SIGINT", () => {
    log("interrompendo com segurança (o checkpoint fica salvo)…");
    ctrl.abort();
  });
  const common = { redo: values.refazer, signal: ctrl.signal, log };

  if (command === "status") {
    const runs = await prisma.publicImportRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
    for (const r of runs) log(`${r.source}/${r.kind} ${r.file}: ${r.status} · ${r.linesImported.toLocaleString("pt-BR")} de ${r.linesRead.toLocaleString("pt-BR")} linhas${r.error ? ` · ${r.error}` : ""}`);
    log(`base local: ${await prisma.rfEstabelecimento.count()} estabelecimentos, ${await prisma.laborStat.count()} agregados do CAGED, ${await prisma.cvmCompany.count()} companhias da CVM`);
    return;
  }
  if (command === "receita") {
    if (values["limpar-socios"]) {
      await prisma.$transaction([prisma.rfSociosResumo.deleteMany({}), prisma.publicImportRun.deleteMany({ where: { source: "receita_aberta", kind: "socios" } })]);
      return log("resumo de sócios apagado: importe de novo todos os arquivos de Sócios.");
    }
    const kind = values.tipo as ReceitaKind;
    if (!RECEITA_KINDS.includes(kind)) throw new Error(`--tipo deve ser um destes: ${RECEITA_KINDS.join(", ")}`);
    if (kind === "estabelecimentos" && !values.uf && !values.municipio) throw new Error("Estabelecimentos exige recorte: informe --uf (e, se quiser, --municipio com o código da Receita). A base nacional inteira não é importada.");
    return report(await importReceita(kind, fileOf(values.arquivo), { ...common, filters: { ...(values.uf ? { uf: values.uf.toUpperCase() } : {}), ...(values.municipio ? { municipio: values.municipio } : {}) } }));
  }
  if (command === "caged") {
    const encoding = values.codificacao === "latin1" ? "latin1" : "utf8";
    return report(await importCaged(fileOf(values.arquivo), { ...common, uf: values.uf?.toUpperCase(), city: values.municipio, encoding }));
  }
  if (command === "cvm") {
    if (values.tipo === "cadastro") return report(await importCvmCadastro(fileOf(values.arquivo), common));
    if (values.tipo === "dfp") return report(await importCvmDfp(fileOf(values.arquivo), common));
    throw new Error("--tipo deve ser cadastro ou dfp.");
  }
  throw new Error("Comando: receita | caged | cvm | status (veja o topo deste arquivo).");
}

main()
  .catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
