// Rótulos em português para enums da API.

export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  MANAGER: "Gestor",
  SALES: "Comercial",
  VIEWER: "Leitura",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  QUEUED: "Na fila",
  SUBMITTED: "Enviada ao motor",
  RUNNING: "Coletando",
  DOWNLOADING: "Baixando resultados",
  IMPORTING: "Importando",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

export const SOURCE_LABEL: Record<string, string> = {
  GOOGLE_MAPS_SCRAPER: "Google Maps (scraper)",
  OSM_OVERPASS: "OpenStreetMap",
  CSV_IMPORT: "Importação CSV",
  MANUAL: "Cadastro manual",
  WEBSITE: "Site oficial",
  BRASILAPI_CNPJ: "CNPJ (BrasilAPI)",
  SYSTEM: "Sistema",
};

export const DATA_STATUS_LABEL: Record<string, string> = {
  FOUND: "Encontrado",
  VERIFIED: "Verificado",
  ESTIMATED: "Estimado",
  UNAVAILABLE: "Indisponível",
  INVALID: "Inválido",
};

export const ENRICHMENT_LABEL: Record<string, string> = {
  NOT_STARTED: "Não enriquecido",
  QUEUED: "Na fila",
  RUNNING: "Enriquecendo",
  DONE: "Enriquecido",
  PARTIAL: "Parcial",
  FAILED: "Falhou",
  SKIPPED: "Sem site",
};

export const SCORE_LABEL: Record<string, string> = {
  DATA_QUALITY: "Qualidade dos dados",
  GOOGLE_PRESENCE: "Presença no Google",
  WEBSITE_QUALITY: "Qualidade do site",
  MULTICHANNEL: "Presença multicanal",
  OPPORTUNITY: "Oportunidade comercial",
};

export const SOCIAL_LABEL: Record<string, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  PINTEREST: "Pinterest",
  X: "X (Twitter)",
  WHATSAPP: "WhatsApp",
  THREADS: "Threads",
  OTHER: "Outro",
};

export const PRIORITY_LABEL: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };

export const ACTIVITY_LABEL: Record<string, string> = {
  NOTE: "Anotação",
  CALL: "Ligação",
  MEETING: "Reunião",
  EMAIL: "E-mail",
  WHATSAPP: "WhatsApp",
  STAGE_CHANGE: "Mudança de etapa",
  TASK: "Tarefa",
  DEAL: "Negociação",
  IMPORT: "Importação",
  ENRICHMENT: "Enriquecimento",
  AUDIT: "Auditoria",
  FIELD_CHANGE: "Alteração de dados",
  CONSENT: "Consentimento",
  SYSTEM: "Sistema",
};

export const MESSAGE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  PENDING_APPROVAL: "Aguardando aprovação",
  APPROVED: "Aprovada",
  QUEUED: "Na fila",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  RECEIVED: "Recebida",
  FAILED: "Falhou",
  BLOCKED: "Bloqueada",
};

/** Cor do marcador de cada etapa do funil. */
export const STAGE_DOT: Record<string, string> = {
  slate: "bg-slate-400", sky: "bg-sky-500", teal: "bg-teal-500", emerald: "bg-emerald-500", lime: "bg-lime-500", amber: "bg-amber-500",
  orange: "bg-orange-500", violet: "bg-violet-500", green: "bg-green-600", rose: "bg-rose-500", blue: "bg-blue-500", pink: "bg-pink-500",
};
