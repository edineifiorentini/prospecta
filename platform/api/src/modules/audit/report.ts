import type { ScoreKind } from "../../lib/prisma.ts";
import { CRITERIA, type DimensionScore, type Evaluation } from "./scoring.ts";

export type Finding = { key: string; label: string; detail: string | null; url: string | null; dimension: ScoreKind; severity: "alta" | "média" | "baixa" };
export type Recommendation = { key: string; title: string; action: string; impact: "Alto" | "Médio" | "Baixo"; priority: 1 | 2 | 3; evidence: string | null; url: string | null };
export type Service = { key: string; name: string; reason: string };

/** Recomendação associada a cada critério que falhou (texto acionável, sem promessas). */
const RECS: Record<string, { title: string; action: string; impact: Recommendation["impact"]; priority: Recommendation["priority"]; service?: string }> = {
  "site.reachable": { title: "Restabelecer o site", action: "Verificar hospedagem/domínio e colocar o site no ar; enquanto isso, remover o link quebrado dos perfis públicos.", impact: "Alto", priority: 1, service: "manutencao" },
  "site.https": { title: "Ativar HTTPS com redirecionamento", action: "Instalar certificado SSL (ex.: Let's Encrypt) e redirecionar todo acesso HTTP para HTTPS.", impact: "Alto", priority: 1, service: "https" },
  "site.mobile": { title: "Adaptar o site ao celular", action: "Adicionar meta viewport e revisar o layout responsivo.", impact: "Alto", priority: 1, service: "site" },
  "site.performance": { title: "Melhorar a velocidade", action: "Otimizar imagens, cache e scripts; meta de LCP abaixo de 2,5 s no celular.", impact: "Alto", priority: 2, service: "performance" },
  "site.title": { title: "Ajustar o título da página", action: "Usar título de 10–70 caracteres com o nome e o serviço principal + cidade.", impact: "Médio", priority: 2, service: "seo" },
  "site.meta_description": { title: "Escrever a meta description", action: "Resumo de 50–170 caracteres com a proposta de valor e a cidade.", impact: "Médio", priority: 2, service: "seo" },
  "site.h1": { title: "Corrigir a hierarquia de títulos", action: "Manter um único H1 descritivo por página.", impact: "Baixo", priority: 3, service: "seo" },
  "site.h2": { title: "Estruturar o conteúdo com subtítulos", action: "Organizar seções com H2 (serviços, diferenciais, contato).", impact: "Baixo", priority: 3, service: "seo" },
  "site.broken_links": { title: "Corrigir links quebrados", action: "Atualizar ou remover os links internos com erro.", impact: "Médio", priority: 2, service: "manutencao" },
  "site.contact_page": { title: "Criar página de contato", action: "Página com telefone, WhatsApp, e-mail, endereço, mapa e formulário.", impact: "Alto", priority: 1, service: "conversao" },
  "site.contact_buttons": { title: "Adicionar botões de contato clicáveis", action: "Links tel:, mailto: e WhatsApp visíveis no topo e no rodapé.", impact: "Alto", priority: 1, service: "conversao" },
  "site.cta": { title: "Incluir chamadas para ação", action: "Botões como “Agende sua avaliação” ou “Peça um orçamento” em destaque.", impact: "Médio", priority: 2, service: "conversao" },
  "site.seo": { title: "Resolver alertas de SEO do Lighthouse", action: "Corrigir itens apontados (indexação, links, textos descritivos).", impact: "Médio", priority: 2, service: "seo" },
  "site.open_graph": { title: "Configurar Open Graph", action: "Definir og:title, og:description e og:image para compartilhamentos.", impact: "Baixo", priority: 3, service: "seo" },
  "site.sitemap": { title: "Publicar sitemap XML", action: "Gerar sitemap.xml e enviá-lo ao Google Search Console.", impact: "Baixo", priority: 3, service: "seo" },
  "site.robots": { title: "Publicar robots.txt", action: "Criar robots.txt apontando para o sitemap.", impact: "Baixo", priority: 3, service: "seo" },
  "site.structured_data": { title: "Adicionar dados estruturados", action: "Marcar LocalBusiness/Organization em JSON-LD (nome, endereço, telefone, horário, redes).", impact: "Médio", priority: 2, service: "seo" },
  "site.social_links": { title: "Vincular redes sociais no site", action: "Ícones para os perfis oficiais no cabeçalho ou rodapé.", impact: "Baixo", priority: 3, service: "social" },
  "site.accessibility": { title: "Melhorar acessibilidade", action: "Textos alternativos em imagens, contraste e rótulos de formulário.", impact: "Baixo", priority: 3, service: "site" },
  "site.lang": { title: "Declarar o idioma", action: "Adicionar lang=\"pt-BR\" ao HTML.", impact: "Baixo", priority: 3, service: "seo" },
  "gbp.website": { title: "Vincular o site à ficha do Google", action: "Informar o site oficial no Perfil da Empresa no Google (pelo proprietário).", impact: "Alto", priority: 1, service: "gbp" },
  "gbp.hours": { title: "Publicar horário de funcionamento", action: "Cadastrar horários e feriados no Perfil da Empresa no Google.", impact: "Médio", priority: 2, service: "gbp" },
  "gbp.phone": { title: "Informar telefone na ficha", action: "Adicionar telefone comercial no Perfil da Empresa no Google.", impact: "Alto", priority: 1, service: "gbp" },
  "gbp.description": { title: "Escrever a descrição da ficha", action: "Descrever serviços, diferenciais e região atendida.", impact: "Médio", priority: 2, service: "gbp" },
  "gbp.photos": { title: "Publicar fotos", action: "Adicionar fotos da fachada, equipe, ambiente e serviços.", impact: "Médio", priority: 2, service: "gbp" },
  "gbp.reviews": { title: "Estimular avaliações", action: "Pedir avaliações a clientes satisfeitos e responder a todas.", impact: "Alto", priority: 2, service: "reviews" },
  "gbp.rating": { title: "Trabalhar a reputação", action: "Responder avaliações negativas e corrigir causas recorrentes.", impact: "Alto", priority: 2, service: "reviews" },
  "mc.website": { title: "Ter um site próprio", action: "Site simples e rápido com serviços, prova social e contato.", impact: "Alto", priority: 1, service: "site" },
  "mc.instagram": { title: "Presença no Instagram", action: "Criar ou vincular perfil comercial com link no site.", impact: "Médio", priority: 2, service: "social" },
  "mc.facebook": { title: "Página no Facebook", action: "Criar ou vincular página com informações de contato.", impact: "Baixo", priority: 3, service: "social" },
  "mc.linkedin": { title: "Página no LinkedIn", action: "Página da empresa para relações B2B e recrutamento.", impact: "Baixo", priority: 3, service: "social" },
  "mc.whatsapp": { title: "Divulgar WhatsApp comercial", action: "Publicar link de WhatsApp Business no site e nos perfis.", impact: "Alto", priority: 1, service: "conversao" },
  "mc.email": { title: "Publicar e-mail comercial", action: "E-mail no domínio próprio (ex.: contato@empresa.com.br).", impact: "Médio", priority: 2, service: "email" },
  "mc.consistency": { title: "Padronizar identificadores", action: "Usar o mesmo nome/@ nas redes e no domínio.", impact: "Baixo", priority: 3, service: "social" },
};

const SERVICES: Record<string, string> = {
  site: "Criação ou redesign de site profissional",
  https: "Configuração de HTTPS/SSL",
  performance: "Otimização de performance (Core Web Vitals)",
  seo: "SEO técnico e local",
  conversao: "Otimização de conversão (botões de contato, CTAs, WhatsApp)",
  gbp: "Gestão do Perfil da Empresa no Google",
  reviews: "Estratégia de avaliações e reputação",
  social: "Gestão de redes sociais",
  email: "E-mail profissional no domínio",
  manutencao: "Manutenção e monitoramento do site",
};

const DIM_LABEL: Record<ScoreKind, string> = {
  DATA_QUALITY: "qualidade dos dados",
  GOOGLE_PRESENCE: "presença pública no Google",
  WEBSITE_QUALITY: "qualidade técnica do site",
  MULTICHANNEL: "presença multicanal",
  OPPORTUNITY: "oportunidade comercial",
};

const labelOf = (key: string) => CRITERIA.find((c) => c.key === key)?.label ?? key;
const dimOf = (key: string) => CRITERIA.find((c) => c.key === key)!.dimension;
const level = (s: number | null) => (s == null ? "não avaliada" : s >= 75 ? "boa" : s >= 50 ? "intermediária" : "fraca");

export function buildReport(companyName: string, evals: Evaluation[], scores: Record<ScoreKind, DimensionScore>) {
  const presence = evals.filter((e) => dimOf(e.key) !== "OPPORTUNITY");
  const positives: Finding[] = presence
    .filter((e) => e.result === "PASS" && !e.key.startsWith("dq."))
    .map((e) => ({ key: e.key, label: labelOf(e.key), detail: e.detail ?? null, url: e.url ?? null, dimension: dimOf(e.key), severity: "baixa" as const }));

  const problems: Finding[] = presence
    .filter((e) => (e.result === "FAIL" || e.result === "WARN") && RECS[e.key])
    .map((e) => {
      const rec = RECS[e.key]!;
      return { key: e.key, label: labelOf(e.key), detail: e.detail ?? null, url: e.url ?? null, dimension: dimOf(e.key), severity: (e.result === "FAIL" && rec.impact === "Alto" ? "alta" : e.result === "FAIL" ? "média" : "baixa") as Finding["severity"] };
    })
    .sort((a, b) => ["alta", "média", "baixa"].indexOf(a.severity) - ["alta", "média", "baixa"].indexOf(b.severity));

  const recommendations: Recommendation[] = problems
    .map((p) => {
      const r = RECS[p.key]!;
      const priority = (p.severity === "baixa" ? Math.min(3, r.priority + 1) : r.priority) as Recommendation["priority"];
      return { key: p.key, title: r.title, action: r.action, impact: r.impact, priority, evidence: p.detail, url: p.url };
    })
    .sort((a, b) => a.priority - b.priority || ["Alto", "Médio", "Baixo"].indexOf(a.impact) - ["Alto", "Médio", "Baixo"].indexOf(b.impact));

  const serviceReasons = new Map<string, string[]>();
  for (const p of problems) {
    const s = RECS[p.key]?.service;
    if (!s) continue;
    serviceReasons.set(s, [...(serviceReasons.get(s) ?? []), p.label]);
  }
  const services: Service[] = [...serviceReasons.entries()]
    .map(([key, reasons]) => ({ key, name: SERVICES[key]!, reason: reasons.slice(0, 3).join("; ") }))
    .sort((a, b) => (serviceReasons.get(b.key)?.length ?? 0) - (serviceReasons.get(a.key)?.length ?? 0));

  const evaluatedDims = (Object.keys(scores) as ScoreKind[]).filter((k) => k !== "OPPORTUNITY" && scores[k].score != null);
  const notEvaluated = (Object.keys(scores) as ScoreKind[]).filter((k) => scores[k].score == null).map((k) => DIM_LABEL[k]);
  const avgConf = evaluatedDims.length ? Math.round((evaluatedDims.reduce((s, k) => s + scores[k].confidence, 0) / evaluatedDims.length) * 100) : 0;
  const high = problems.filter((p) => p.severity === "alta").slice(0, 3).map((p) => p.label.toLowerCase());
  const opp = scores.OPPORTUNITY.score;

  const parts = [
    `${companyName}: ${evaluatedDims.map((k) => `${DIM_LABEL[k]} ${level(scores[k].score)} (${scores[k].score}/100)`).join(", ") || "dados insuficientes para avaliar a presença digital"}.`,
    problems.length ? `Foram encontrados ${problems.length} ponto(s) de melhoria com evidência${high.length ? `, com destaque para: ${high.join("; ")}` : ""}.` : "Nenhum problema relevante foi encontrado nos itens que puderam ser verificados.",
    positives.length ? `Pontos fortes: ${positives.slice(0, 3).map((p) => p.label.toLowerCase()).join("; ")}.` : "",
    opp != null ? `Indicador de oportunidade comercial: ${opp}/100 (${opp >= 60 ? "alta" : opp >= 35 ? "moderada" : "baixa"}).` : "",
    notEvaluated.length ? `Não avaliado por falta de dados acessíveis: ${notEvaluated.join(", ")}.` : "",
    `Confiança média da análise: ${avgConf}% dos critérios puderam ser verificados. Esta é uma estimativa interna baseada em dados públicos, não uma auditoria oficial do Google.`,
  ];
  return { summary: parts.filter(Boolean).join(" "), positives, problems, recommendations, services };
}
