import {
  BarChart3,
  Building2,
  CalendarClock,
  FileSearch,
  Globe,
  KanbanSquare,
  MessageCircle,
  PhoneCall,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";

export type ChecklistKey = "search" | "review" | "enrich" | "audit" | "crm" | "task" | "contact" | "whatsapp" | "report" | "team";

export type GuideStep = {
  key: ChecklistKey;
  icon: LucideIcon;
  title: string;
  why: string;
  how: string[];
  href: string;
  cta: string;
  /** passo do tour que mostra onde fica */
  tourStep: number;
  optional?: boolean;
  permission?: string;
};

/** Roteiro de primeiros passos. A conclusão de cada passo vem dos registros reais (GET /api/me/onboarding). */
export const GUIDE: GuideStep[] = [
  {
    key: "search",
    icon: Search,
    title: "Encontre as primeiras empresas",
    why: "É daqui que saem os leads: uma busca por tipo de negócio e cidade traz empresas reais, com a origem de cada dado.",
    how: [
      "Abra Encontrar Empresas, informe o tipo de negócio (ex.: dentista) e a cidade.",
      "Use o OpenStreetMap, gratuito e liberado; o Google Maps é opcional e pode bloquear seu IP por um tempo.",
      "Comece com limite pequeno (20–50) e acompanhe o andamento à direita.",
    ],
    href: "/buscar",
    cta: "Fazer uma busca",
    tourStep: 5,
    permission: "search:run",
  },
  {
    key: "review",
    icon: Building2,
    title: "Revise e filtre os leads",
    why: "Filtrar cedo evita perder tempo com empresas sem contato ou fora do perfil.",
    how: [
      "Em Empresas, use Filtros: sem site, sem telefone, nota, cidade e segmento.",
      "Abra a ficha de uma empresa: cada informação mostra de onde veio e o grau de confiança.",
      "Salve grupos de empresas em Minhas Listas para trabalhar depois.",
    ],
    href: "/empresas",
    cta: "Ver empresas",
    tourStep: 7,
  },
  {
    key: "enrich",
    icon: Globe,
    title: "Enriqueça pelo site oficial",
    why: "O site da própria empresa costuma ter e-mail, WhatsApp e redes sociais que as fontes públicas não trazem.",
    how: [
      "Selecione empresas com site na lista e clique em Enriquecer (ou use o botão na ficha).",
      "A coleta respeita o robots.txt e marca cada contato como encontrado ou verificado.",
      "E-mail com MX válido não é garantia de entrega; a ficha mostra o que foi verificado.",
    ],
    href: "/empresas?website=with",
    cta: "Empresas com site",
    tourStep: 7,
    permission: "enrich:run",
  },
  {
    key: "audit",
    icon: FileSearch,
    title: "Rode uma auditoria digital",
    why: "Mostra lacunas concretas (site lento, sem HTTPS, dados incompletos) que viram argumento de venda.",
    how: [
      "Na ficha da empresa, aba Auditoria → Auditar agora.",
      "São 5 pontuações com evidências; o que não pôde ser verificado aparece como Não avaliado.",
      "Baixe o PDF para enviar ao cliente ou usar na reunião.",
    ],
    href: "/auditorias",
    cta: "Ver auditorias",
    tourStep: 11,
    permission: "audit:run",
  },
  {
    key: "crm",
    icon: KanbanSquare,
    title: "Leve um lead ao CRM",
    why: "No funil você enxerga em que etapa cada negociação está e o valor em aberto.",
    how: [
      "Na ficha, clique em Adicionar ao CRM (ou envie várias empresas de uma vez pela lista).",
      "No CRM, arraste o cartão entre as etapas; pelo teclado: espaço + setas.",
      "Ajuste as etapas do funil no botão Etapas.",
    ],
    href: "/crm",
    cta: "Abrir o CRM",
    tourStep: 9,
    permission: "crm:write",
  },
  {
    key: "task",
    icon: CalendarClock,
    title: "Agende o próximo contato",
    why: "Tarefas com prazo garantem que nenhum lead esfrie; você recebe lembrete por e-mail.",
    how: ["Em Tarefas (ou na ficha da empresa), escreva o que fazer e escolha prazo e prioridade.", "O painel mostra as tarefas atrasadas e as do dia."],
    href: "/tarefas",
    cta: "Criar tarefa",
    tourStep: 10,
    permission: "tasks:write",
  },
  {
    key: "contact",
    icon: PhoneCall,
    title: "Registre um contato",
    why: "O histórico de ligações, reuniões e e-mails alimenta os indicadores de contatos realizados.",
    how: ["Na ficha da empresa, aba Atividades → registre ligação, reunião ou e-mail com o resultado.", "Tudo aparece na linha do tempo da empresa."],
    href: "/empresas?inCrm=yes",
    cta: "Leads no CRM",
    tourStep: 7,
    permission: "crm:write",
  },
  {
    key: "whatsapp",
    icon: MessageCircle,
    title: "Conecte um WhatsApp de teste",
    why: "Centraliza as conversas com os leads e registra o histórico na ficha.",
    how: [
      "Em Configurações → WhatsApp, crie a instância e leia o QR Code com um número de teste autorizado.",
      "Envio só com autorização registrada ou em resposta a quem escreveu nas últimas 24 h.",
      "Número público não é autorização para iniciar conversa.",
    ],
    href: "/configuracoes?tab=whatsapp",
    cta: "Configurar WhatsApp",
    tourStep: 12,
    optional: true,
    permission: "messaging:manage",
  },
  {
    key: "report",
    icon: BarChart3,
    title: "Acompanhe e exporte resultados",
    why: "O painel e os relatórios mostram novos leads, contatos, conversão e funil no período escolhido.",
    how: ["No Dashboard, escolha período, cidade e segmento.", "Em Relatórios, exporte o resumo em PDF ou CSV e as listas de negociações, atividades e tarefas."],
    href: "/relatorios",
    cta: "Abrir relatórios",
    tourStep: 13,
    permission: "export:run",
  },
  {
    key: "team",
    icon: Users,
    title: "Convide sua equipe",
    why: "Cada pessoa tem seu acesso e perfil (Administrador, Gestor, Comercial ou Leitura).",
    how: ["Em Configurações → Usuários, convide pelo e-mail; o convite chega com link para definir a senha."],
    href: "/configuracoes?tab=usuarios",
    cta: "Convidar",
    tourStep: 1,
    optional: true,
    permission: "users:manage",
  },
];

export type TourStep = {
  route: string;
  /** alvos em ordem de preferência (atributo data-tour); sem alvo, o balão fica centralizado */
  targets?: string[];
  title: string;
  body: string;
};

export const TOUR: TourStep[] = [
  {
    route: "/dashboard",
    title: "Boas-vindas ao Prospecta",
    body: "Em cerca de 2 minutos você vê onde fica cada parte da plataforma. Use as setas do teclado para avançar e Esc para sair; dá para retomar depois em Primeiros passos.",
  },
  { route: "/dashboard", targets: ["nav"], title: "Menu principal", body: "Daqui você chega a tudo: encontrar empresas, sua base, listas, CRM, auditorias, conversas, tarefas e relatórios. O botão ao lado da busca recolhe o menu." },
  { route: "/dashboard", targets: ["global-search"], title: "Busca global", body: "Procure qualquer empresa, negociação ou tarefa por nome, telefone ou domínio. Atalho: Ctrl + K." },
  { route: "/dashboard", targets: ["dashboard-filters"], title: "Período e recortes", body: "Os indicadores respeitam o período, a cidade e o segmento escolhidos aqui. O endereço da página guarda os filtros." },
  {
    route: "/dashboard",
    targets: ["dashboard-kpis", "page-header"],
    title: "Indicadores reais",
    body: "Tudo é calculado a partir dos seus registros. Passe o mouse sobre o título de um indicador para ver como é calculado; clique para abrir a lista correspondente.",
  },
  {
    route: "/buscar",
    targets: ["search-form"],
    title: "Encontrar empresas",
    body: "Informe o tipo de negócio e a cidade. O OpenStreetMap é gratuito e liberado; o Google Maps é opcional e pode bloquear seu IP temporariamente. Também dá para importar uma planilha CSV.",
  },
  { route: "/buscar", targets: ["search-jobs"], title: "Andamento das buscas", body: "Cada busca roda em segundo plano. Acompanhe aqui e abra os resultados; empresas repetidas são unificadas automaticamente." },
  {
    route: "/empresas",
    targets: ["companies-table", "page-header"],
    title: "Sua base de leads",
    body: "Filtre por cidade, segmento, nota, falta de site ou telefone. Marque várias empresas para enriquecer, auditar, adicionar a uma lista ou enviar ao CRM.",
  },
  { route: "/empresas", targets: ["new-company", "page-header"], title: "Cadastro manual", body: "Precisa incluir uma empresa que você já conhece? Cadastre à mão; a plataforma avisa se ela já existir." },
  {
    route: "/crm",
    targets: ["kanban", "page-header"],
    title: "Funil de vendas",
    body: "Arraste os cartões entre as etapas (ou use espaço + setas). Cada mudança fica registrada na linha do tempo da empresa.",
  },
  { route: "/tarefas", targets: ["tasks", "page-header"], title: "Tarefas e lembretes", body: "Agende retornos com prazo; o lembrete chega por e-mail e as tarefas atrasadas aparecem no painel." },
  {
    route: "/auditorias",
    targets: ["page-header"],
    title: "Auditoria digital",
    body: "Avalia site, presença no Google, redes e qualidade dos dados com evidências. O que não pôde ser verificado aparece como “Não avaliado”. Cada auditoria gera um PDF.",
  },
  {
    route: "/conversas",
    targets: ["page-header"],
    title: "Conversas de WhatsApp",
    body: "O histórico fica vinculado a cada lead. Conecte um número de teste em Configurações → WhatsApp; envio só com autorização registrada ou em resposta ao contato.",
  },
  { route: "/relatorios", targets: ["reports", "page-header"], title: "Relatórios", body: "Exporte o resumo de indicadores (PDF ou CSV), negociações, atividades, tarefas e mensagens com o mesmo período e filtros do painel." },
  {
    route: "/primeiros-passos",
    targets: ["guide", "page-header"],
    title: "Seu roteiro",
    body: "Este roteiro marca sozinho o que já foi feito. Siga os passos pendentes. Para rever o tour, use o menu do seu nome → Tour guiado.",
  },
];
