# Relatório das fases 1 a 8

O diagnóstico (fase 0) está em [FASE-0-DIAGNOSTICO.md](FASE-0-DIAGNOSTICO.md). Todo o trabalho está em commits locais na branch `feat/plataforma-prospeccao` do fork `edineifiorentini/google-maps-scraper-kit`. Nada foi enviado ao GitHub nem publicado.

## Fase 1 — Infraestrutura

**Implementado**

- Docker Compose com Postgres 17, Valkey 8, Mailpit, WuzAPI, API, worker, web e gateway nginx.
- Só o gateway e o Mailpit são publicados, ambos em 127.0.0.1.
- Scripts que geram o `.env` e o `.env.dev`.
- Perfil `kit-ui` para a interface original do kit.

**Reutilizado:** imagem do motor gosom do kit (v1.18.1), na rede interna.

**Testes:** subida completa, `restart`, `down`/`up` sem perda de dados; outros projetos Docker não foram afetados.

**Riscos:** o nginx do gateway roda o processo mestre como root (padrão da imagem oficial).

## Fase 2 — Pesquisa de empresas

**Implementado**

- Adaptadores OpenStreetMap (Overpass + Nominatim, com tentativas e servidores espelho), Google Maps Scraper (opcional, com aviso de Termos e limpeza do job no motor) e importação CSV.
- Fila com andamento, deduplicação e filtros.

**Testes:** 25 dentistas em Campinas (OSM); 10 dentistas no Cambuí (Google Maps, ~30 s); importação CSV; deduplicação.

**Problemas resolvidos:** HTTP 502 transitório do Overpass, tratado com novas tentativas e espelhos.

## Fase 3 — Enriquecimento

**Implementado**

- Crawler do site oficial com robots.txt e proteção SSRF (inclusive contra DNS rebinding).
- E-mails com checagem MX (sem prometer entrega), telefones E.164, WhatsApp divulgado pela empresa, redes sociais com evidência e checagem de link, CNPJ (BrasilAPI).

**Testes:** site de demonstração fictício e example.com, mais testes unitários de SSRF e extração.

## Fase 4 — CRM e autenticação

**Implementado**

- Login com Argon2id, sessões, CSRF, perfis de acesso, bloqueio por tentativas e recuperação de senha por e-mail.
- Ficha da empresa com procedência, funil com etapas configuráveis, tarefas com lembrete, atividades, anotações, usuários e convites, trilha de auditoria e retenção.

**Testes:** integração de autenticação, RBAC, isolamento entre organizações e CRM.

**Problemas resolvidos:** a listagem de empresas dava erro com a ordenação padrão (`nulls last` em coluna obrigatória).

## Fase 5 — Auditoria digital

**Implementado**

- Cinco dimensões com critérios ponderados e confiança; "não avaliado" fica fora do cálculo.
- Evidências, Lighthouse local e relatório em PDF.
- Metodologia documentada.

**Testes:** auditoria na pilha Docker (Lighthouse e PDF conferidos) e unitários de pontuação.

**Problemas resolvidos:**

- O worker caía quando o Chrome não existia; agora há verificação prévia.
- A auditoria consultava páginas proibidas pelo robots.txt; agora as filtra.

## Fase 6 — WhatsApp (WuzAPI)

**Implementado**

- Instância por conta, com token cifrado.
- Webhook com HMAC sobre o corpo bruto e deduplicação.
- Política de envio: lista de bloqueio, consentimento, janela de 24 h, aprovação de gestor e limites.
- Opt-out automático, histórico vinculado ao lead e adaptador da Cloud API oficial.

**Testes:** QR Code real exibido na interface; assinatura validada; integração da política de envio.

**Problemas resolvidos:** o WuzAPI 1.0.9 só assina os webhooks após configurar a chave HMAC; a plataforma reaplica a chave automaticamente.

**Pendente:** parear um número de teste e trocar mensagens reais. Depende do usuário.

## Fase 7 — Painel e acabamento

**Implementado**

- Métricas reais com filtros de período, cidade e segmento.
- Página de Relatórios com CSV e PDF; cada indicador acompanha a regra de cálculo.
- Atalhos do painel para a lista filtrada.
- Cálculo periódico da qualidade dos dados.

**Problemas resolvidos:**

- Ranking por segmento ignorava o filtro.
- Linhas duplicadas na tabela de resultados de busca.
- Rolagem horizontal em celulares.
- Status do WhatsApp incoerente com o QR Code.
- Regras do React Compiler.

**Testes:** integração do painel e das exportações; verificação visual no claro, no escuro e em 375 px.

## Fase 8 — Testes e validação

**Implementado**

- Privacidade (LGPD): localizar, exportar e excluir dados de um titular, com bloqueio de nova coleta.
- Backup e restauração verificáveis.
- Suíte E2E (Playwright) e revisão de segurança.
- Senha temporária com troca obrigatória e CLI para criar ou recuperar o Proprietário.

**Problemas resolvidos:**

- Cabeçalhos de segurança duplicados e conflitantes (`X-Frame-Options`) entre gateway e aplicações.
- CLI do shadcn listada como dependência de produção (7 alertas do `npm audit`).
- O gateway resolvia os IPs dos containers só ao iniciar: recriar a API ou o web podia gerar erro 502. Agora usa o DNS do Docker a cada requisição.

**Verificação final:** `docker compose restart` de toda a pilha sem perda de dados (85 empresas, 3 negociações, 94 atividades, 3 usuários antes e depois).

## Resultado dos testes (20/10/2026)

| Suíte | Resultado |
|---|---|
| Unitários (API) | 78/78 |
| Integração (API, banco `prospecta_test`) | 37/37 |
| Ponta a ponta (Playwright + Edge, pilha Docker) | 19/19 |
| `npm audit --omit=dev` | 0 vulnerabilidades (api, web, e2e) |

## Riscos e limitações conhecidos

- A raspagem do Google Maps contraria os Termos do Google e pode gerar bloqueio de IP; o OpenStreetMap é o padrão.
- O WuzAPI é não oficial. O número pode ser bloqueado pelo WhatsApp; use apenas números de teste e migre para a Cloud API em produção.
- As pontuações são estimativas internas; não são avaliações oficiais.
- `COOKIE_SECURE=false` porque o acesso é http em localhost. Se a plataforma for servida em outra máquina, coloque HTTPS e mude para `true`.
