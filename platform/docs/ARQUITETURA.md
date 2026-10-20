# Arquitetura

## Visão geral

```
                    navegador (http://localhost:3000)
                                 │
                 ┌───────────────▼───────────────┐   rede "edge"
                 │ platform-gateway (nginx 1.30) │   publicado só em 127.0.0.1:3000
                 └──────┬─────────────────┬──────┘   bloqueia /api/webhooks/* de fora
                   /api/│                 │/
          ┌─────────────▼──────┐   ┌──────▼─────────────┐
          │ platform-api       │   │ platform-web       │
          │ Fastify 5 + Zod    │   │ Next.js 16 (React) │
          └──┬──────┬──────┬───┘   └────────────────────┘
             │      │      │ enfileira jobs              rede "backend" (interna)
   ┌─────────▼──┐ ┌─▼──────▼──┐ ┌───────────────────────────────────────────┐
   │ postgres   │ │ valkey 8  │◄┤ platform-worker (mesma imagem da API)     │
   │ 17         │ │ (BullMQ)  │ │ busca · enriquecimento · auditoria · envio│
   └────────────┘ └───────────┘ │ WhatsApp · manutenção (retenção, lembretes)│
                                └──┬──────────────┬─────────────┬────────────┘
                                   │              │             │
                      ┌────────────▼───┐  ┌───────▼──────┐  ┌───▼────────────────────┐
                      │ wuzapi 1.0.9   │  │ mailpit      │  │ google-maps-scraper    │
                      │ (WhatsApp, não │  │ (SMTP local) │  │ (gosom v1.18.1, kit)   │
                      │ oficial)       │  └──────────────┘  └────────────────────────┘
                      └────────────────┘
   Internet (somente saída): OpenStreetMap Overpass/Nominatim, sites oficiais das empresas
   (crawler com proteção SSRF e robots.txt), BrasilAPI (CNPJ), DNS (MX), Google Maps (via gosom).
```

Todos os serviços estão no Docker Compose (projeto `prospecta`). O `docker-compose.yml` da raiz inclui `platform/compose.yaml`. A interface original do kit (`web`, porta 8080) só sobe com o perfil `kit-ui`, e o site fictício de demonstração com o perfil `demo`.

## Componentes

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| `platform/web` | Next.js 16, React 19, Tailwind 4, shadcn/ui (Radix), TanStack Query/Table, React Hook Form + Zod, dnd-kit, Recharts | Interface. Não acessa o banco: só chama a API. O `proxy.ts` redireciona para o login quem não tem cookie, mas quem autoriza é sempre a API. |
| `platform/api` | Node 24, Fastify 5, Zod 4, Prisma 7 (adapter pg), BullMQ 6, undici, Crawlee, Playwright, Lighthouse | API REST com OpenAPI, regras de negócio e (com `ROLE=worker`) os processadores de filas |
| `platform/gateway` | nginx | Único ponto publicado. Aplica os cabeçalhos de segurança e bloqueia os webhooks externos. |
| `platform/e2e` | Playwright 1.64 | Testes ponta a ponta usando o Edge ou o Chrome instalado |
| `platform/scripts` | Node (sem dependências) | Gerar `.env`/`.env.dev`, backup e restauração |

## Módulos da API (`platform/api/src/modules`)

| Módulo | Função |
|---|---|
| `auth` | Login, sessão, CSRF, perfis, troca e recuperação de senha, senha temporária |
| `orgs` | Organização, configurações, etapas padrão do funil, usuários e convites |
| `sources` | Adaptadores de descoberta: OpenStreetMap (Overpass), Google Maps Scraper (gosom) e CSV |
| `search` | Fila de buscas, andamento, deduplicação e gravação dos resultados |
| `companies` | Ficha da empresa, contatos, procedência por campo, listas, etiquetas, exportação |
| `enrichment` | Crawler do site oficial, extração e verificação de contatos, redes e CNPJ |
| `audit` | Avaliação por critérios, pontuações com confiança, Lighthouse, relatório HTML/PDF |
| `crm` | Funil, negociações, tarefas, atividades e anotações |
| `messaging` | Provedores (WuzAPI e Cloud API), política de envio, consentimento, webhooks assinados |
| `reports` | Métricas do painel e exportações (CSV/PDF) |
| `privacy` | Pedidos de titulares (localizar, exportar, excluir) e bloqueio de coleta |
| `maintenance` | Retenção, lembretes, reconciliação de jobs travados, cálculo de qualidade dos dados |

Filas (BullMQ sobre Valkey):

| Fila | Concorrência | Observação |
|---|---|---|
| `search` | 1 | |
| `enrichment` | 2 | |
| `audit` | 1 | |
| `messaging` | 1 | no máximo 20 por minuto, além dos limites da organização |
| `maintenance` | — | agendadores: retenção diária às 03:00, lembretes a cada 5 min, status do WhatsApp a cada 60 s, jobs travados e qualidade dos dados a cada 10 min |

## Dados

Banco PostgreSQL 17, migrações do Prisma em `platform/api/prisma/migrations` (aplicadas automaticamente ao iniciar a API).

| Grupo | Tabelas principais |
|---|---|
| Acesso | `users`, `memberships`, `sessions`, `password_reset_tokens`, `audit_logs` |
| Empresas | `companies`, `company_field_sources`, `contacts`, `company_websites`, `social_profiles`, `lead_sources`, `tags`, `company_lists` |
| Coleta | `search_jobs`, `search_results`, `enrichment_jobs`, `geocode_cache` |
| Auditoria | `digital_audits`, `audit_evidence`, `company_scores` |
| CRM | `pipelines`, `pipeline_stages`, `deals`, `tasks`, `activities`, `notes` |
| Mensagens | `messaging_accounts`, `conversations`, `messages`, `message_templates`, `webhook_events`, `contact_consents`, `suppression_list` |

Princípios:

- **Procedência.** Cada valor tem origem, URL, data e status (`FOUND`, `VERIFIED`, `ESTIMATED`, `UNAVAILABLE` ou `INVALID`) com grau de confiança. Nada é inventado: o que não foi encontrado fica vazio ou como "não avaliado".
- **Deduplicação.** Chaves normalizadas (nome, telefone E.164, domínio e endereço), além dos IDs da fonte (place id do Google, id do OSM).
- **Pontuações.** Critério atendido vale 1, parcial 0,5 e não atendido 0; "não avaliado" fica fora do cálculo. A confiança é o peso avaliado dividido pelo peso total; abaixo de 30% o resultado é "não avaliado". Detalhes em [METODOLOGIA-PONTUACAO.md](METODOLOGIA-PONTUACAO.md).

## Segurança

**Exposição**

- Só o gateway (127.0.0.1:3000) e a interface do Mailpit (127.0.0.1:8025, com senha) são publicados.
- WuzAPI, banco, Valkey e o motor do Google Maps ficam na rede interna.

**Autenticação**

- Senhas com Argon2id (parâmetros OWASP).
- Cookie de sessão `HttpOnly` + `SameSite=Lax`; no banco fica só o SHA-256 do token.
- Expiração por inatividade (7 dias) e absoluta (30 dias).
- Bloqueio após 8 tentativas, recuperação de senha por link de uso único (30 min) e senha temporária com troca obrigatória.

**Autorização**

- Cada rota declara uma permissão. Os perfis são Proprietário, Administrador, Gestor, Comercial e Leitura.
- Todo acesso a dados filtra pela organização da sessão.

**Proteção das requisições**

- CSRF: token por sessão no cabeçalho `x-csrf-token` e lista de origens permitidas.
- Limite de requisições no Valkey (600/min por cliente, com limites menores no login e na recuperação de senha).

**Crawler (SSRF)**

- Só http/https e portas 80/443/8080/8443.
- Bloqueia IPs privados, de loopback e de metadados, inclusive na resolução de DNS da conexão (contra *DNS rebinding*).
- Revalida cada redirecionamento e limita tamanho e tempo.
- Respeita o robots.txt.

**Segredos**

- Tokens do WhatsApp cifrados com AES-256-GCM (`APP_ENCRYPTION_KEY`).
- `.env`, `.env.dev`, backups e `platform/.local/` fora do Git.

**Webhooks do WuzAPI**

- HMAC-SHA256 sobre o corpo bruto, deduplicação por evento, token removido do payload guardado e bloqueio no gateway.

**Exportações**

- Proteção contra fórmulas em CSV.
- Exigem a permissão `export:run` e ficam registradas na trilha de auditoria.

**Cabeçalhos**

- CSP (sem `frame-ancestors`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` e `Permissions-Policy`.
- O gateway é a fonte única dos cabeçalhos comuns.

## Decisões e alternativas gratuitas

| Decisão | Motivo |
|---|---|
| Valkey (BSD) | No lugar do Redis, por causa da licença; compatível com o BullMQ |
| Mailpit | E-mail transacional de teste local; troque `SMTP_URL` para um provedor real |
| OpenStreetMap como fonte padrão | Gratuito e de uso permitido. O Google Maps Scraper é opcional, com avisos. |
| BrasilAPI | Consulta pública de CNPJ |
| Lighthouse local | No lugar da API PageSpeed, que exige chave |
| WuzAPI para testes | Adaptador da WhatsApp Business Cloud API pronto para uso oficial |
