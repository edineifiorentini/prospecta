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
  /** classes CNAE (4 primeiros dígitos) do segmento: usadas quando há cadastro oficial da empresa */
  cnaeClasses?: string[];
  painHypotheses: string[];
  diagnosticQuestions: string[];
};

export const SEGMENTS: SegmentProfile[] = [
  {
    id: "imobiliaria",
    label: "Imobiliária",
    terms: ["imobiliaria", "imoveis", "imovel", "corretor de imoveis", "corretora de imoveis", "real estate", "administradora de imoveis", "loteadora"],
    // 6821 corretagem e avaliação de imóveis; 6822 gestão e administração da propriedade imobiliária
    cnaeClasses: ["6821", "6822"],
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
    // 6920 atividades de contabilidade, consultoria e auditoria contábil e tributária
    cnaeClasses: ["6920"],
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
    // 6911 atividades jurídicas (exceto cartórios)
    cnaeClasses: ["6911"],
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
    // 7311 agências de publicidade; 7312 agenciamento de espaços; 7319 outras atividades de publicidade
    cnaeClasses: ["7311", "7312", "7319"],
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

export type SegmentMatch = { segment: SegmentProfile; matchedTerm: string; field: "category" | "cnae" | "name" };

/** Classe CNAE (4 dígitos) de um código como "L-6821-8/01", "6821-8/01" ou "6821801". */
export const cnaeClass = (code: string | null | undefined) => (code ?? "").replace(/\D/g, "").slice(0, 4) || null;

/** Identifica o segmento pela categoria (preferência), pelo CNAE principal oficial ou, por último, pelo nome. */
export function detectSegment(input: { category?: string | null; categories?: string[] | null; name: string; cnae?: string | null }): SegmentMatch | null {
  const cats = [input.category, ...(input.categories ?? [])].filter((v): v is string => !!v).map(fold);
  const name = fold(input.name);
  const termMatch = (haystacks: string[], field: "category" | "name") => {
    for (const segment of SEGMENTS) {
      for (const term of segment.terms) {
        const re = new RegExp(`\\b${term.replace(/ /g, "\\s+")}`);
        if (haystacks.some((h) => re.test(h))) return { segment, matchedTerm: term, field };
      }
    }
    return null;
  };
  const byCategory = termMatch(cats, "category");
  if (byCategory) return byCategory;
  const cls = cnaeClass(input.cnae);
  const byCnae = cls ? SEGMENTS.find((s) => s.cnaeClasses?.includes(cls)) : undefined;
  if (byCnae) return { segment: byCnae, matchedTerm: input.cnae!, field: "cnae" };
  return termMatch([name], "name");
}
