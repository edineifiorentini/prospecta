import { fold } from "../../lib/normalize.ts";

/**
 * Perfis de segmento para a análise comercial.
 *
 * As dores listadas são HIPÓTESES GERAIS DE MERCADO para orientar a conversa, nunca
 * características atribuídas automaticamente a uma empresa. Para incluir um segmento novo,
 * basta acrescentar um item em SEGMENTS: o motor de pontuação e o prompt da IA leem esta lista.
 */
export type SegmentProfile = {
  id: string;
  label: string;
  /** termos procurados (sem acento, minúsculas) na categoria e no nome da empresa */
  terms: string[];
  painHypotheses: string[];
  diagnosticQuestions: string[];
};

export const SEGMENTS: SegmentProfile[] = [
  {
    id: "imobiliaria",
    label: "Imobiliária",
    terms: ["imobiliaria", "imoveis", "imovel", "corretor de imoveis", "corretora de imoveis", "real estate", "administradora de imoveis", "loteadora"],
    painHypotheses: [
      "Distribuição dos interessados entre os corretores",
      "Tempo de resposta a quem pergunta por um imóvel",
      "Organização dos leads que chegam por portais, site e redes",
      "Continuidade do atendimento quando o corretor muda ou sai",
      "Histórico das conversas acessível para a equipe",
    ],
    diagnosticQuestions: [
      "Quando alguém pergunta por um imóvel, quem responde primeiro e em quanto tempo?",
      "Os corretores usam o próprio celular ou um número da imobiliária?",
      "Se um corretor sai, o histórico das conversas com os clientes fica com a empresa?",
      "Como vocês sabem quantos contatos chegaram no mês e quantos viraram visita?",
    ],
  },
  {
    id: "contabilidade",
    label: "Contabilidade",
    terms: ["contabil", "contabilidade", "contador", "contadora", "escritorio contabil", "assessoria contabil", "accounting"],
    painHypotheses: [
      "Atendimento separado por setor (fiscal, pessoal, contábil)",
      "Recebimento de documentos dos clientes pelo WhatsApp",
      "Solicitações pendentes que se perdem entre colaboradores",
      "Histórico compartilhado do que cada cliente já pediu",
      "Organização do trabalho entre a equipe",
    ],
    diagnosticQuestions: [
      "Os clientes mandam documentos e dúvidas para um número só ou para cada colaborador?",
      "Como vocês acompanham uma solicitação do cliente até ela ser resolvida?",
      "Quando alguém da equipe sai de férias, outra pessoa consegue continuar a conversa?",
      "Quantas pessoas atendem clientes pelo WhatsApp hoje?",
    ],
  },
  {
    id: "advocacia",
    label: "Advocacia",
    terms: ["advocacia", "advogado", "advogada", "advogados", "escritorio de advocacia", "juridico", "law firm"],
    painHypotheses: [
      "Acompanhamento das solicitações dos clientes",
      "Continuidade dos retornos sobre o andamento dos casos",
      "Organização do histórico de cada atendimento",
      "Controle de acesso e sigilo profissional nas conversas",
      "Comunicação durante e fora do expediente",
    ],
    diagnosticQuestions: [
      "Como os clientes pedem notícias do andamento dos casos hoje?",
      "Quem da equipe tem acesso às conversas com cada cliente?",
      "Como vocês tratam mensagens que chegam fora do horário de atendimento?",
      "O histórico das conversas fica registrado junto com o caso?",
    ],
  },
  {
    id: "agencia_marketing",
    label: "Agência de marketing",
    terms: ["agencia de marketing", "marketing digital", "agencia de publicidade", "publicidade", "agencia digital", "propaganda", "social media", "agencia de comunicacao"],
    painHypotheses: [
      "Solicitações dos clientes chegando por vários canais",
      "Envio de briefings e arquivos",
      "Pedidos de ajuste e rodadas de aprovação de materiais",
      "Distribuição entre atendimento, criação e gestão",
    ],
    diagnosticQuestions: [
      "Os clientes pedem ajustes direto para o designer ou passam por um atendimento?",
      "Como fica registrado quem aprovou cada material e quando?",
      "Quantos grupos de WhatsApp com clientes vocês mantêm hoje?",
      "Como a equipe sabe o que está pendente para cada cliente?",
    ],
  },
];

export const segmentById = (id: string) => SEGMENTS.find((s) => s.id === id) ?? null;

export type SegmentMatch = { segment: SegmentProfile; matchedTerm: string; field: "category" | "name" };

/** Identifica o segmento pela categoria (preferência) ou, na falta dela, pelo nome. */
export function detectSegment(input: { category?: string | null; categories?: string[] | null; name: string }): SegmentMatch | null {
  const cats = [input.category, ...(input.categories ?? [])].filter((v): v is string => !!v).map(fold);
  const name = fold(input.name);
  for (const field of ["category", "name"] as const) {
    const haystacks = field === "category" ? cats : [name];
    for (const segment of SEGMENTS) {
      for (const term of segment.terms) {
        const re = new RegExp(`\\b${term.replace(/ /g, "\\s+")}`);
        if (haystacks.some((h) => re.test(h))) return { segment, matchedTerm: term, field };
      }
    }
  }
  return null;
}
