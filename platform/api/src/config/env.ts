import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ROLE: z.enum(["api", "worker", "cli"]).default("api"),
  PORT: z.coerce.number().int().default(4000),
  // 0.0.0.0 no contêiner; o ambiente de teste isolado usa 127.0.0.1
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "APP_ENCRYPTION_KEY deve ter 32 bytes em base64"),
  SESSION_SECRET: z.string().min(32),
  ADMIN_BOOTSTRAP_TOKEN: z.string().optional().default(""),
  COOKIE_SECURE: bool,
  SMTP_URL: z.string().default("smtp://mailpit:1025"),
  MAIL_FROM: z.string().default("Prospecta <no-reply@prospecta.local>"),
  GMAPS_SCRAPER_URL: z.string().url().default("http://google-maps-scraper:8080"),
  GMAPS_SCRAPER_ENABLED: bool,
  OVERPASS_URL: z.string().url().default("https://overpass-api.de/api/interpreter"),
  NOMINATIM_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  /** chave do mapa do Google (Maps JavaScript API), restrita por site; vazia = mapa do OpenStreetMap */
  GOOGLE_MAPS_API_KEY: z.string().trim().default(""),
  /** ID de mapa do Google (marcadores avançados); vazio = DEMO_MAP_ID, liberado pelo Google para testes */
  GOOGLE_MAPS_MAP_ID: z.string().trim().default(""),
  /** chave de servidor para localizar cidades pelo Google (Geocoding API), restrita só por API; opcional */
  GOOGLE_GEOCODING_API_KEY: z.string().trim().default(""),
  /** fontes de busca habilitadas, separadas por vírgula (padrão: só o Google Maps) */
  SEARCH_SOURCES: z.string().default("GOOGLE_MAPS_SCRAPER"),
  /** geocodificador reserva (Photon/komoot, dados do OpenStreetMap) */
  PHOTON_URL: z.string().url().default("https://photon.komoot.io"),
  HTTP_USER_AGENT: z.string().default("ProspectaBot/0.1 (+local)"),
  WUZAPI_URL: z.string().url().default("http://wuzapi:8080"),
  WUZAPI_ADMIN_TOKEN: z.string().default(""),
  WUZAPI_WEBHOOK_URL: z.string().url().default("http://platform-api:4000/api/webhooks/wuzapi"),
  /// destinos internos adicionais que o crawler pode acessar (somente testes locais)
  CRAWLER_ALLOW_HOSTS: z.string().optional().default(""),
  // Chaves de IA não ficam aqui: cada conta cadastra as próprias, cifradas no banco (modules/ai/credentials.ts).
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    // Nunca imprime valores, apenas os nomes das variáveis com problema.
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
