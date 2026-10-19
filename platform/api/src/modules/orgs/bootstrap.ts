import type { Prisma } from "../../lib/prisma.ts";
import { defaultOrgSettings } from "./settings.ts";

type Tx = Prisma.TransactionClient;

export const DEFAULT_STAGES: { name: string; color: string; kind: "OPEN" | "WON" | "LOST" }[] = [
  { name: "Novo lead", color: "slate", kind: "OPEN" },
  { name: "Em qualificação", color: "sky", kind: "OPEN" },
  { name: "Qualificado", color: "teal", kind: "OPEN" },
  { name: "Contato autorizado", color: "emerald", kind: "OPEN" },
  { name: "Primeiro contato realizado", color: "lime", kind: "OPEN" },
  { name: "Aguardando retorno", color: "amber", kind: "OPEN" },
  { name: "Em negociação", color: "orange", kind: "OPEN" },
  { name: "Proposta enviada", color: "violet", kind: "OPEN" },
  { name: "Ganho", color: "green", kind: "WON" },
  { name: "Perdido", color: "rose", kind: "LOST" },
];

const DEFAULT_TEMPLATES = [
  {
    name: "Resposta inicial",
    category: "ATENDIMENTO",
    body: "Olá, {{contato}}! Aqui é {{usuario}}, da {{organizacao}}. Obrigado pelo retorno. Como posso ajudar?",
  },
  {
    name: "Envio de diagnóstico autorizado",
    category: "AUTORIZADO",
    body: "Olá, {{contato}}! Conforme combinado, preparei um diagnóstico da presença digital da {{empresa}}. Posso enviar por aqui?",
  },
  {
    name: "Confirmação de opt-out",
    category: "SISTEMA",
    body: "Pronto, {{contato}}. Você não receberá mais mensagens nossas por este canal.",
  },
];

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "organizacao";

/** Cria uma organização com pipeline padrão e modelos de mensagem iniciais. */
export async function bootstrapOrganization(tx: Tx, name: string) {
  const base = slugify(name);
  const taken = await tx.organization.count({ where: { slug: { startsWith: base } } });
  const organization = await tx.organization.create({
    data: { name, slug: taken ? `${base}-${taken + 1}` : base, settings: defaultOrgSettings() as object },
  });
  await tx.pipeline.create({
    data: {
      organizationId: organization.id,
      name: "Pipeline comercial",
      isDefault: true,
      stages: { create: DEFAULT_STAGES.map((s, i) => ({ ...s, position: i })) },
    },
  });
  await tx.messageTemplate.createMany({ data: DEFAULT_TEMPLATES.map((t) => ({ ...t, organizationId: organization.id })) });
  return organization;
}
