import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { toCsv } from "../../lib/csv.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { orgId } from "../../plugins/auth.ts";
import { renderPdf } from "../audit/pdf.ts";
import { dashboardMetrics, metricsQuery, resolvePeriod, TZ } from "./metrics.ts";
import { renderDashboardHtml, summaryRows } from "./summary.ts";

const MAX_ROWS = 20_000;
const fmt = (d: Date | null | undefined) => (d ? d.toLocaleString("pt-BR", { timeZone: TZ }) : "");
const money = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
const stamp = () => new Date().toISOString().slice(0, 10);

const DEAL_STATUS: Record<string, string> = { OPEN: "Aberta", WON: "Ganha", LOST: "Perdida", ARCHIVED: "Arquivada" };
const TASK_STATUS: Record<string, string> = { OPEN: "Aberta", DONE: "Concluída", CANCELLED: "Cancelada" };
const PRIORITY: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };
const ACTIVITY: Record<string, string> = {
  NOTE: "Anotação", CALL: "Ligação", MEETING: "Reunião", EMAIL: "E-mail", WHATSAPP: "WhatsApp", STAGE_CHANGE: "Mudança de etapa", TASK: "Tarefa",
  DEAL: "Negociação", IMPORT: "Importação", ENRICHMENT: "Enriquecimento", AUDIT: "Auditoria", FIELD_CHANGE: "Alteração de campo", CONSENT: "Consentimento",
};

function sendCsv(reply: FastifyReply, name: string, csv: string) {
  return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="${name}-${stamp()}.csv"`).send(csv);
}

const companyScope = (q: { city?: string; category?: string }): Prisma.CompanyWhereInput | undefined =>
  q.city || q.category ? { ...(q.city ? { city: q.city } : {}), ...(q.category ? { category: q.category } : {}) } : undefined;

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/dashboard", { schema: { tags: ["reports"], summary: "Métricas do painel (período e filtros opcionais)", querystring: metricsQuery } }, async (req) => {
    return dashboardMetrics(orgId(req), req.query);
  });

  app.get("/reports/summary", { schema: { tags: ["reports"], summary: "Resumo de indicadores com definições (JSON)", querystring: metricsQuery } }, async (req) => {
    const m = await dashboardMetrics(orgId(req), req.query);
    return { period: m.period, rows: summaryRows(m) };
  });

  app.get("/reports/summary.csv", { config: { permission: "export:run" }, schema: { tags: ["reports"], summary: "Resumo de indicadores (CSV)", querystring: metricsQuery } }, async (req, reply) => {
    const m = await dashboardMetrics(orgId(req), req.query);
    await writeAudit(req, { action: "report.summary_exported", metadata: { format: "csv", ...req.query } });
    return sendCsv(reply, "resumo-indicadores", toCsv([{ key: "group", label: "Grupo" }, { key: "label", label: "Indicador" }, { key: "value", label: "Valor" }, { key: "definition", label: "Como é calculado" }], summaryRows(m)));
  });

  app.get("/reports/summary.pdf", { config: { permission: "export:run" }, schema: { tags: ["reports"], summary: "Resumo de indicadores (PDF)", querystring: metricsQuery.extend({ format: z.enum(["pdf", "html"]).optional() }) } }, async (req, reply) => {
    const organizationId = orgId(req);
    const [m, org] = await Promise.all([dashboardMetrics(organizationId, req.query), prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })]);
    const html = renderDashboardHtml(org.name, m);
    if (req.query.format === "html") return reply.header("Content-Type", "text/html; charset=utf-8").header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'").send(html);
    const pdf = await renderPdf(html);
    await writeAudit(req, { action: "report.summary_exported", metadata: { format: "pdf", from: m.period.from, to: m.period.to } });
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="resumo-indicadores-${stamp()}.pdf"`).send(pdf);
  });

  app.get("/reports/deals.csv", { config: { permission: "export:run" }, schema: { tags: ["reports"], summary: "Negociações do funil (CSV)", querystring: metricsQuery.extend({ status: z.enum(["OPEN", "WON", "LOST", "ARCHIVED"]).optional() }) } }, async (req, reply) => {
    const organizationId = orgId(req);
    const company = companyScope(req.query);
    const rows = await prisma.deal.findMany({
      where: { organizationId, ...(req.query.status ? { status: req.query.status } : {}), ...(company ? { company } : {}) },
      orderBy: [{ stage: { position: "asc" } }, { position: "asc" }],
      take: MAX_ROWS,
      include: { company: { select: { name: true, city: true, category: true } }, stage: { select: { name: true } }, owner: { select: { name: true } } },
    });
    await writeAudit(req, { action: "report.deals_exported", metadata: { rows: rows.length, ...req.query } });
    return sendCsv(
      reply,
      "negociacoes",
      toCsv(
        [
          { key: "title", label: "Negociação" }, { key: "company", label: "Empresa" }, { key: "city", label: "Cidade" }, { key: "category", label: "Segmento" },
          { key: "stage", label: "Etapa" }, { key: "status", label: "Situação" }, { key: "value", label: "Valor estimado (R$)" }, { key: "owner", label: "Responsável" },
          { key: "expected", label: "Previsão de fechamento" }, { key: "created", label: "Criada em" }, { key: "closed", label: "Fechada em" }, { key: "lostReason", label: "Motivo da perda" },
        ],
        rows.map((d) => ({
          title: d.title, company: d.company.name, city: d.company.city, category: d.company.category, stage: d.stage.name, status: DEAL_STATUS[d.status],
          value: money(d.valueCents), owner: d.owner?.name, expected: fmt(d.expectedCloseDate), created: fmt(d.createdAt), closed: fmt(d.closedAt), lostReason: d.lostReason,
        })),
      ),
    );
  });

  app.get("/reports/activities.csv", { config: { permission: "export:run" }, schema: { tags: ["reports"], summary: "Atividades registradas no período (CSV)", querystring: metricsQuery } }, async (req, reply) => {
    const organizationId = orgId(req);
    const { from, to } = resolvePeriod(req.query);
    const company = companyScope(req.query);
    const rows = await prisma.activity.findMany({
      where: { organizationId, occurredAt: { gte: from, lte: to }, ...(company ? { company } : {}) },
      orderBy: { occurredAt: "desc" },
      take: MAX_ROWS,
      include: { company: { select: { name: true } }, user: { select: { name: true } } },
    });
    await writeAudit(req, { action: "report.activities_exported", metadata: { rows: rows.length, ...req.query } });
    return sendCsv(
      reply,
      "atividades",
      toCsv(
        [{ key: "when", label: "Data" }, { key: "type", label: "Tipo" }, { key: "title", label: "Título" }, { key: "body", label: "Descrição" }, { key: "company", label: "Empresa" }, { key: "user", label: "Usuário" }],
        rows.map((a) => ({ when: fmt(a.occurredAt), type: ACTIVITY[a.type] ?? a.type, title: a.title, body: a.body, company: a.company?.name, user: a.user?.name })),
      ),
    );
  });

  app.get("/reports/tasks.csv", { config: { permission: "export:run" }, schema: { tags: ["reports"], summary: "Tarefas abertas e concluídas no período (CSV)", querystring: metricsQuery } }, async (req, reply) => {
    const organizationId = orgId(req);
    const { from, to } = resolvePeriod(req.query);
    const company = companyScope(req.query);
    const rows = await prisma.task.findMany({
      where: { organizationId, OR: [{ status: "OPEN" }, { completedAt: { gte: from, lte: to } }, { createdAt: { gte: from, lte: to } }], ...(company ? { company } : {}) },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      take: MAX_ROWS,
      include: { company: { select: { name: true } }, assignee: { select: { name: true } } },
    });
    await writeAudit(req, { action: "report.tasks_exported", metadata: { rows: rows.length, ...req.query } });
    return sendCsv(
      reply,
      "tarefas",
      toCsv(
        [
          { key: "title", label: "Tarefa" }, { key: "status", label: "Situação" }, { key: "priority", label: "Prioridade" }, { key: "due", label: "Prazo" },
          { key: "company", label: "Empresa" }, { key: "assignee", label: "Responsável" }, { key: "created", label: "Criada em" }, { key: "completed", label: "Concluída em" },
        ],
        rows.map((t) => ({
          title: t.title, status: TASK_STATUS[t.status], priority: PRIORITY[t.priority], due: fmt(t.dueAt), company: t.company?.name, assignee: t.assignee?.name,
          created: fmt(t.createdAt), completed: fmt(t.completedAt),
        })),
      ),
    );
  });

  app.get("/reports/messages.csv", { config: { permission: "export:run" }, schema: { tags: ["reports"], summary: "Histórico de mensagens do WhatsApp no período (CSV)", querystring: metricsQuery } }, async (req, reply) => {
    const organizationId = orgId(req);
    const { from, to } = resolvePeriod(req.query);
    const company = companyScope(req.query);
    const rows = await prisma.message.findMany({
      where: { organizationId, createdAt: { gte: from, lte: to }, ...(company ? { conversation: { company } } : {}) },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      include: { conversation: { select: { contactPhone: true, contactName: true, company: { select: { name: true } } } }, sentBy: { select: { name: true } } },
    });
    await writeAudit(req, { action: "report.messages_exported", metadata: { rows: rows.length, ...req.query } });
    return sendCsv(
      reply,
      "mensagens",
      toCsv(
        [
          { key: "when", label: "Data" }, { key: "direction", label: "Direção" }, { key: "status", label: "Situação" }, { key: "phone", label: "Número" },
          { key: "contact", label: "Contato" }, { key: "company", label: "Empresa" }, { key: "body", label: "Mensagem" }, { key: "sentBy", label: "Enviada por" },
        ],
        rows.map((m) => ({
          when: fmt(m.createdAt), direction: m.direction === "INBOUND" ? "Recebida" : "Enviada", status: m.status, phone: m.conversation.contactPhone,
          contact: m.conversation.contactName, company: m.conversation.company?.name, body: m.body, sentBy: m.sentBy?.name,
        })),
      ),
    );
  });
};
