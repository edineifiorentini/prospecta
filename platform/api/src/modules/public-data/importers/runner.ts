import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { prisma, type Prisma } from "../../../lib/prisma.ts";

/**
 * Importação de arquivos públicos grandes em streaming: lê linha a linha (memória constante), grava em lotes e
 * guarda o checkpoint NA MESMA transação do lote. Depois de uma falha ou cancelamento, a próxima execução com o
 * mesmo arquivo e filtros continua da última linha gravada — sem duplicar nem perder linhas.
 */

/** Uma linha CSV com aspas opcionais ("" escapa aspas). */
export function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export type ImportSpec = {
  source: string;
  kind: string;
  filePath: string;
  encoding: "latin1" | "utf8";
  delimiter: string;
  /** a primeira linha é cabeçalho (repassado a cada lote) */
  header: boolean;
  filters?: Record<string, unknown>;
  batchSize?: number;
  /** importa de novo um arquivo já concluído (o chamador limpa o que for preciso em `onRedo`) */
  redo?: boolean;
  signal?: AbortSignal;
  onRedo?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** grava um lote; devolve quantas linhas foram aproveitadas (as demais foram filtradas) */
  onBatch: (rows: string[][], header: string[] | null, tx: Prisma.TransactionClient) => Promise<number>;
  log?: (msg: string) => void;
};

export type ImportResult = { runId: string; status: "COMPLETED" | "FAILED" | "CANCELLED" | "SKIPPED"; linesRead: number; linesImported: number; resumedFrom: number; error?: string };

export async function runImport(spec: ImportSpec): Promise<ImportResult> {
  const file = basename(spec.filePath);
  const filters = (spec.filters ?? {}) as Prisma.InputJsonValue;
  const size = BigInt(statSync(spec.filePath).size);
  const previous = await prisma.publicImportRun.findFirst({ where: { source: spec.source, kind: spec.kind, file, fileSize: size, filters: { equals: filters } }, orderBy: { startedAt: "desc" } });

  if (previous?.status === "COMPLETED" && !spec.redo) {
    spec.log?.(`${file}: já importado em ${previous.finishedAt?.toISOString()} (use --refazer para importar de novo)`);
    return { runId: previous.id, status: "SKIPPED", linesRead: previous.linesRead, linesImported: previous.linesImported, resumedFrom: 0 };
  }
  const resume = previous && previous.status !== "COMPLETED" && !spec.redo ? previous : null;
  if (spec.redo && spec.onRedo) await prisma.$transaction((tx) => spec.onRedo!(tx));
  const run = resume
    ? await prisma.publicImportRun.update({ where: { id: resume.id }, data: { status: "RUNNING", error: null, finishedAt: null } })
    : await prisma.publicImportRun.create({ data: { source: spec.source, kind: spec.kind, file, fileSize: size, filters, status: "RUNNING" } });
  const skip = resume?.checkpoint ?? 0;
  if (skip) spec.log?.(`${file}: retomando depois da linha ${skip}`);

  const batchSize = spec.batchSize ?? 1000;
  let header: string[] | null = null;
  let dataLines = 0;
  let imported = run.linesImported;
  let batch: string[][] = [];
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    await prisma.$transaction(
      async (tx) => {
        const n = await spec.onBatch(rows, header, tx);
        imported += n;
        await tx.publicImportRun.update({ where: { id: run.id }, data: { checkpoint: dataLines, linesRead: dataLines, linesImported: imported } });
      },
      { timeout: 120_000 },
    );
  };

  const stream = createReadStream(spec.filePath, { encoding: spec.encoding });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const raw of lines) {
      if (spec.signal?.aborted) throw Object.assign(new Error("cancelado"), { cancelled: true });
      const line = header === null && spec.header ? raw.replace(/^﻿/, "") : raw;
      if (!line.trim()) continue;
      if (spec.header && header === null) {
        header = parseCsvLine(line, spec.delimiter);
        continue;
      }
      dataLines++;
      if (dataLines <= skip) continue;
      batch.push(parseCsvLine(line, spec.delimiter));
      if (batch.length >= batchSize) {
        await flush();
        if (dataLines % (batchSize * 50) === 0) spec.log?.(`${file}: ${dataLines.toLocaleString("pt-BR")} linhas`);
      }
    }
    await flush();
    await prisma.publicImportRun.update({ where: { id: run.id }, data: { status: "COMPLETED", linesRead: dataLines, linesImported: imported, checkpoint: dataLines, finishedAt: new Date() } });
    return { runId: run.id, status: "COMPLETED", linesRead: dataLines, linesImported: imported, resumedFrom: skip };
  } catch (err) {
    const cancelled = (err as { cancelled?: boolean }).cancelled === true;
    const message = (err as Error).message.slice(0, 500);
    await prisma.publicImportRun.update({ where: { id: run.id }, data: { status: cancelled ? "CANCELLED" : "FAILED", error: message, finishedAt: new Date() } });
    const saved = await prisma.publicImportRun.findUniqueOrThrow({ where: { id: run.id } });
    return { runId: run.id, status: cancelled ? "CANCELLED" : "FAILED", linesRead: saved.linesRead, linesImported: saved.linesImported, resumedFrom: skip, error: message };
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Nome de coluna sem acento nem símbolo, robusto a arquivo lido com a codificação errada ("seção" → "seo"). */
export const columnSkeleton = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
