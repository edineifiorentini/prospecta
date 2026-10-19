# Fase 0 — Diagnóstico

Data: 2026-10-19 · Máquina: Windows 11 Pro (build 26300), AMD Ryzen 5 5500 (6c/12t), 15,9 GB RAM.

## 1. Ambiente local

| Item | Situação | Observação |
|---|---|---|
| Git | 2.55.0 | ok |
| GitHub CLI | 2.101.0, autenticado como `edineifiorentini` (escopos `repo`, `workflow`, `gist`, `read:org`) | ok |
| Docker Desktop | 29.8.1, Compose v5.5.1, VM com 12 CPUs / 7,7 GB | estava parado; foi iniciado |
| WSL2 | distribuição `docker-desktop`, versão padrão 2 | ok |
| Node.js / npm | 24.19.0 / 11.17.0 | ok (LTS) |
| Python | apenas o atalho da Microsoft Store (não instalado de fato) | não é necessário: o script Python do kit é opcional |
| PostgreSQL / Redis locais | não instalados | serão usados via containers isolados |
| Portas 3000, 4000, 5432, 6379, 8080, 8081, 8025 | livres | todas as publicações serão em `127.0.0.1` |
| Disco | C: 622 GB livres · D: 515 GB livres | ok |
| Outros projetos Docker | volumes do projeto `tarefafacil` (Supabase) e imagens `postgres:16-alpine` | **não serão tocados**; o projeto usa nome Compose próprio (`prospecta`) |

## 2. Repositório

- Fork já existia: `edineifiorentini/google-maps-scraper-kit` (fork de `vzbaggio/google-maps-scraper-kit`, que por sua vez é fork de `felipenunes07/google-maps-scraper-kit`).
- Clonado em `D:\Desktop\SCRAPPER MAPS`.
- Remotes: `origin` → fork do usuário; `upstream` → `vzbaggio/google-maps-scraper-kit` (push para `upstream` desabilitado com URL inválida, por segurança).
- `master` está em sincronia com `upstream/master` (0 commits de diferença).
- Nenhum push será feito nesta fase.

## 3. O que o kit contém

| Arquivo | Função |
|---|---|
| `docker-compose.yml` | `gosom/google-maps-scraper:v1.18.1` (modo `-web`) + `nginx:1.27-alpine` publicado em `127.0.0.1:8080` |
| `nginx.conf`, `scraper-proxy.inc` | `/` (Mapa), `/painel`, `/app/*` (assets), `/classic` (UI original) e proxy da API |
| `frontend/` | HTML/CSS/JS estático (Leaflet + Nominatim + OSM tiles), sem build |
| `scripts/scrape.py`, `scrape.sh` | cliente da API (criar → acompanhar → baixar CSV), extração opcional de redes sociais por regex |
| `.claude/skills/google-maps-scraper/SKILL.md` + `commands/` | instruções para o Claude operar a API |
| `LICENSE` (MIT, kit), `CREDITS.md` (MIT, gosom) | licenças a preservar |

### API REST do motor (gosom v1.18.1, verificada no código-fonte e no `spec.yaml`)

- `POST /api/v1/jobs` → `{"id": "<uuid>"}` (201). Campos: `name`, `keywords[]`, `lang` (2 letras, obrigatório), `zoom`, `lat`, `lon` (strings), `fast_mode`, `radius` (m), `depth` (obrigatório), `email`, `max_time` (segundos, obrigatório), `proxies[]`.
- `GET /api/v1/jobs`, `GET /api/v1/jobs/{id}` → `status` ∈ `pending | working | ok | failed`.
- `GET /api/v1/jobs/{id}/download` → CSV com 34 colunas (`title, category, address, website, phone, review_count, review_rating, latitude, longitude, cid, place_id, open_hours, emails, …`).
- `DELETE /api/v1/jobs/{id}` → remove job e CSV.
- Execução **sequencial** (um job por vez), `max_time` mínimo efetivo de 180 s. **Não há cancelamento**: `DELETE` em job `working` não interrompe o processo; o adaptador marca o job como cancelado, descarta os resultados e remove o job ao final.
- **Sem autenticação** — por isso nunca pode ser exposto fora da rede interna.

## 4. Versões e licenças verificadas

| Componente | Versão escolhida | Licença | Observação |
|---|---|---|---|
| gosom/google-maps-scraper | v1.18.1 (latest) | MIT | uso contra o Google Maps viola os Termos do Google → adaptador **opcional** com avisos |
| WuzAPI | v1.0.9 (latest, imagem `asternic/wuzapi:1.0.9`) | MIT | não oficial; risco de banimento do número; HMAC `x-hmac-signature` suportado |
| PostgreSQL | 17-alpine | PostgreSQL License | |
| Valkey (no lugar de Redis) | 8-alpine | BSD-3 | Redis ≥ 7.4 mudou para RSAL/SSPL/AGPL; Valkey é compatível com BullMQ e livre para uso comercial |
| Node.js | 24 LTS | MIT | |
| Next.js / React | 16.4.2 / 19.3.1 | MIT | |
| Tailwind CSS / shadcn/ui | 4.3.3 / CLI 4.22.1 | MIT | |
| Fastify | 5.12.7 | MIT | API REST tipada + OpenAPI |
| Prisma ORM | 7.10.1 (estável) | Apache-2.0 | a tag `latest` do npm aponta para um RC (8.0.0-rc.23); fixado na última estável |
| TypeScript | 5.9.x | Apache-2.0 | TS 7 (port nativo em Go) ainda sem API compatível com parte do ecossistema |
| BullMQ | 6.x | MIT | |
| Zod | 4.x | MIT | |
| Crawlee (Cheerio + Playwright) | 3.18.2 / 1.64.1 | Apache-2.0 | |
| Lighthouse | 13.5.0 | Apache-2.0 | executado localmente no worker |
| TanStack Table | 8.21.x | MIT | v9 é recente e ainda sem exemplos do shadcn |
| @node-rs/argon2 | 2.2.2 | MIT | Argon2id com binário pré-compilado (Windows/Linux) |
| libphonenumber-js | 1.13.x | MIT | normalização E.164 |
| Mailpit | v1.31.4 | MIT | captura local de e-mails (recuperação de senha) |
| Firecrawl | **não adotado** | AGPL-3.0 (self-host) / pago (cloud) | sem vantagem demonstrável sobre Crawlee para este escopo |

## 5. Revisão de segurança do código de terceiros

- Kit: frontend escapa HTML (`esc()`) em todos os `innerHTML`; risco baixo de `href="javascript:"` se um site raspado vier malformado (será tratado na nova plataforma validando o esquema `http/https`).
- Script Python: sem `eval`/`subprocess`; apenas `urllib`.
- nginx do kit: expõe a API **sem autenticação** em `127.0.0.1:8080`. Decisão: a UI do kit continua disponível, mas passa a ser **opt-in** (perfil Compose `kit-ui`), para que nenhuma API sem autenticação fique aberta por padrão.
- Imagens oficiais fixadas por versão; nenhuma imagem `latest`.
- Exportações CSV da plataforma terão proteção contra *CSV/formula injection*.

## 6. Inventário: reutilizar × desenvolver

**Reutilizado:** motor gosom (imagem oficial, sem modificação), mapeamento de colunas do CSV, regras de uso do SKILL.md (um job por vez, profundidade baixa, avisos de bloqueio/LGPD), padrões de geocodificação Nominatim, regex de redes sociais como ponto de partida, UI do kit (preservada em `/` e `/painel` no perfil `kit-ui`).

**A desenvolver:** plataforma completa em `platform/` (API, worker, web), adaptadores de fontes (Google Maps Scraper opcional, OpenStreetMap/Overpass como fonte aberta, importação CSV), enriquecimento, auditoria, CRM, autenticação, WhatsApp, dashboard, testes, backup.

## 7. Arquitetura proposta

```
127.0.0.1:3000 ─► gateway (nginx) ─┬─► web (Next.js 16)        /
                                   └─► api (Fastify 5)         /api/*  (OpenAPI em /api/docs)
api ─► postgres (dados) · valkey (filas BullMQ, rate limit) · mailpit (SMTP local)
worker (BullMQ) ─► scraper gosom (rede interna) · Overpass/Nominatim · sites (Crawlee) · Lighthouse · BrasilAPI (CNPJ)
wuzapi (rede interna) ◄──► api (webhook assinado com HMAC)
```

Módulos da API: `auth`, `orgs/users (RBAC)`, `sources` (adaptadores), `search`, `companies`, `enrichment`, `audit`, `crm` (pipelines, deals, tarefas, atividades, notas), `messaging` (adaptador WuzAPI / WhatsApp Cloud), `consent/suppression`, `reports`, `privacy (LGPD)`, `audit-log`.

## 8. Riscos identificados

1. Raspagem do Google Maps viola os Termos do Google e pode bloquear o IP temporariamente → adaptador opcional, desativável, com avisos, um job por vez e profundidade baixa.
2. WuzAPI não é oficial → risco de banimento do número; nenhum disparo em massa; envio só com consentimento registrado ou resposta a conversa iniciada pelo contato; adaptador pronto para a API oficial.
3. Dados de contato são dados pessoais (LGPD) → finalidade, base legal, opt-out, lista de supressão, retenção e atendimento a titulares documentados.
4. Recursos de memória: a pilha completa usa ~3 GB em pico (Chromium do scraper e do worker); a VM do Docker tem 7,7 GB.
5. O pareamento do WhatsApp depende de o usuário escanear o QR Code com um número de teste.
