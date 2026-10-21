# Prospecta — prospecção B2B e CRM local

Plataforma que roda inteira no seu computador: encontra empresas em fontes públicas, enriquece os dados a partir do site oficial, faz uma auditoria digital com evidências, organiza os leads num CRM com funil e tarefas, registra conversas de WhatsApp autorizadas e gera painéis e relatórios.

Ela fica no diretório `platform/` deste fork do **Google Maps Scraper Kit**. O motor do kit ([gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper), MIT) é usado como **adaptador opcional**, ao lado do OpenStreetMap.

- Arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Manutenção e operação: [docs/MANUTENCAO.md](docs/MANUTENCAO.md)
- Colocar no ar 24 h numa VPS, com domínio e HTTPS: [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md)
- Metodologia das pontuações: [docs/METODOLOGIA-PONTUACAO.md](docs/METODOLOGIA-PONTUACAO.md)
- Relatório das fases: [docs/fases/](docs/fases/)

## Requisitos

- Docker Desktop (testado com Docker 29) com o Compose v2
- Node.js 22.19 ou mais novo (só para os scripts de ambiente, backup e testes)
- Cerca de 6 GB livres para as imagens

## Primeira execução

Na raiz do repositório (`D:\Desktop\SCRAPPER MAPS`):

```bash
node platform/scripts/init-env.mjs
```

O comando cria o `.env` a partir do `.env.example` e gera todos os segredos. O `.env` nunca vai para o Git.

```bash
docker compose up -d --build
```

Depois abra **http://localhost:3000**.

Para criar o primeiro acesso, use uma das duas formas:

- **Tela de configuração inicial** (`/setup`): informe o `ADMIN_BOOTSTRAP_TOKEN` do `.env`. Ela só funciona enquanto não houver nenhum usuário.
- **Linha de comando**: cria ou recupera um Proprietário com senha temporária, que precisa ser trocada no primeiro login.

```bash
docker compose exec platform-api node dist/cli/owner.js --email voce@exemplo.com --name "Seu Nome"
```

## Endereços

| O quê | Endereço | Observação |
|---|---|---|
| Plataforma | http://localhost:3000 | gateway nginx, só em 127.0.0.1 |
| Documentação da API (OpenAPI) | http://localhost:3000/api/docs | exige login |
| Saúde da API | http://localhost:3000/api/health | |
| Caixa de e-mails de teste (Mailpit) | http://localhost:8025 | usuário e senha em `MAILPIT_UI_AUTH` no `.env` |
| Interface original do kit (opcional) | http://localhost:8080 | `docker compose --profile kit-ui up -d web`; sem login, uso local |

Banco, filas, WuzAPI e o motor do Google Maps ficam só na rede interna dos containers.

## Iniciar, parar e verificar

| Ação | Comando |
|---|---|
| Iniciar | `docker compose up -d` |
| Parar sem apagar nada | `docker compose stop` (ou `docker compose down`) |
| Estado dos serviços | `docker compose ps` (ou Configurações → Sistema) |
| Logs | `docker compose logs -f platform-api platform-worker` |
| Atualizar depois de mudar o código | `docker compose up -d --build` |

Os dados ficam nos volumes `prospecta_pgdata` (banco), `prospecta_wuzapidata` (sessão do WhatsApp) e `prospecta_valkeydata` (filas). **Não use `docker compose down -v`**: o `-v` apaga os volumes.

## Uso

No primeiro acesso, um **tour guiado** apresenta as telas principais. O roteiro **Primeiros passos**, no menu lateral, marca sozinho o que já foi feito a partir dos registros reais e mostra o próximo passo. O tour pode ser retomado ou revisto a qualquer momento pelo menu do usuário (Tour guiado).

1. **Encontrar empresas** (*Encontrar Empresas*)
   - Informe palavra-chave, cidade, bairro, raio e limite.
   - Fonte: Google Maps, pelo motor local do kit (gosom). Volumes altos e buscas seguidas podem bloquear o IP por um tempo, e a raspagem contraria os Termos do Google. O OpenStreetMap pode ser reativado com `SEARCH_SOURCES=GOOGLE_MAPS_SCRAPER,OSM_OVERPASS` no `.env`.
   - Também dá para importar uma planilha CSV.
   - Como no kit original, o mapa mostra o local (pino azul) e o raio (círculo) enquanto você preenche a busca; nos resultados, cada empresa vira um pino (vermelho; verde se já está no CRM; cinza se ficou fora do raio). A ficha da empresa também mostra o ponto no mapa. Sem configuração, os mapas são do OpenStreetMap (sem chave nem custo); com `GOOGLE_MAPS_API_KEY` no `.env`, passam a ser do Google, com volta automática para o OpenStreetMap se o Google falhar. Passo a passo e custos em [docs/MANUTENCAO.md](docs/MANUTENCAO.md#mapa-do-google-opcional).
   - O andamento aparece em tempo real e os resultados são deduplicados.
2. **Empresas**
   - Lista com filtros (sem site, sem telefone, nota, avaliações, cidade, segmento, pontuações), ações em lote, listas e exportação CSV.
   - A ficha mostra a origem e o grau de confiança de cada dado.
3. **Enriquecimento**
   - Visita apenas o site oficial, respeitando o robots.txt.
   - Coleta e-mails (com checagem de MX, que não garante entrega), telefones, WhatsApp divulgado pela empresa, redes sociais (com evidência) e CNPJ (BrasilAPI).
4. **Auditoria digital**
   - Cinco pontuações (qualidade dos dados, presença no Google, site, multicanal e oportunidade), com evidências, Lighthouse e PDF.
   - Critérios sem evidência ficam como "Não avaliado".
   - Não é uma avaliação oficial do Google.
5. **CRM**: funil com arrastar e soltar (também pelo teclado), etapas configuráveis, tarefas com lembrete por e-mail, anotações, ligações e linha do tempo.
6. **WhatsApp**
   - Em Configurações → WhatsApp: crie a instância e leia o QR Code com um **número de teste autorizado**.
   - Envio sempre individual, só com autorização registrada ou em resposta a quem escreveu nas últimas 24 h.
   - Inclui opt-out automático, lista de bloqueio, limites por hora e por dia e aprovação de gestor.
   - O WuzAPI é uma integração não oficial. Para uso comercial em escala existe o adaptador da API oficial (WhatsApp Business Cloud API).
7. **Painel e Relatórios**
   - Indicadores calculados dos registros, com filtros de período, cidade e segmento.
   - Exportações em CSV e PDF (resumo, negociações, atividades, tarefas e mensagens).
8. **Privacidade (LGPD)**
   - Em Configurações → Privacidade: localizar, exportar e excluir os dados de um titular.
   - Bloqueio de nova coleta e prazos de retenção aplicados todos os dias às 03:00.

Perfis de acesso: Proprietário, Administrador, Gestor, Comercial e Leitura. A API confere a permissão e a organização em todas as rotas.

## Backup e restauração

```bash
node platform/scripts/backup.mjs
```

Faz o backup do banco em `platform/backups/`, com SHA-256 e um manifesto de contagens por tabela.

- `--with-whatsapp` inclui a sessão do WuzAPI, que contém as credenciais do WhatsApp; guarde o arquivo como se fosse uma senha.
- `--keep 14` mantém só os 14 backups mais recentes.

```bash
node platform/scripts/restore.mjs platform/backups/prospecta-AAAAMMDD-HHMMSS.dump
```

Esse comando só **verifica** o backup:

- confere o SHA-256;
- restaura num banco temporário;
- compara as contagens com o manifesto;
- apaga o banco temporário.

```bash
node platform/scripts/restore.mjs platform/backups/prospecta-AAAAMMDD-HHMMSS.dump --apply --yes
```

Com `--apply --yes`, **substitui** o banco atual. Antes ele salva um backup de segurança (`pre-restore-*.dump`) e para a API e o worker; no final, sobe os dois de novo. Para restaurar também a sessão do WhatsApp, acrescente `--whatsapp <arquivo-wuzapi.tgz>`.

## Testes

| Suíte | Como rodar | Requisitos |
|---|---|---|
| Unitários (83) | `cd platform/api && npm run test:unit` | nenhum |
| Integração (52) | `cd platform/api && npm run test:integration` | Postgres e Valkey publicados (modo desenvolvimento) e `platform/.env.dev`; usa o banco separado `prospecta_test` |
| Ponta a ponta (24) | `cd platform/e2e && npm install && npx playwright test` | pilha rodando em http://localhost:3000; usa o Edge instalado (`E2E_CHANNEL=chrome` para o Chrome) |

Os testes E2E criam um usuário próprio (`e2e@prospecta.local`) com senha temporária e registros com o prefixo `[E2E]`; ao final, apagam esses registros e o próprio usuário.

## Modo desenvolvimento

```bash
docker compose -f docker-compose.yml -f platform/compose.devports.yaml up -d postgres valkey mailpit wuzapi google-maps-scraper
node platform/scripts/dev-env.mjs
```

O primeiro comando sobe os serviços de apoio publicados em 127.0.0.1 (Postgres 5433, Valkey 6380, Mailpit 1025/8025, WuzAPI 8081, motor do Google Maps 8082). O segundo gera o `platform/.env.dev`.

Rode cada processo num terminal:

| Processo | Comando | Endereço |
|---|---|---|
| API | `cd platform/api && npm run dev` | http://localhost:4000 |
| Worker | `cd platform/api && npm run dev:worker` | |
| Web | `cd platform/web && API_PROXY_URL=http://127.0.0.1:4000 npx next dev -p 3001` | http://localhost:3001 |

Não deixe os containers `platform-api` e `platform-worker` rodando junto com os processos do host: as filas seriam consumidas em dobro. Use `docker compose stop platform-api platform-worker`.

## Limites e responsabilidades

- Raspagem do Google Maps contraria os Termos do Google. O adaptador é opcional, avisa sobre os riscos e não contorna CAPTCHA, login ou bloqueios.
- Use volumes pequenos, uma busca por vez e, para uso intenso, proxies.
- Número de telefone público **não é autorização** para iniciar conversas no WhatsApp.
- Dados de contato são dados pessoais: registre a base legal, atenda pedidos de titulares e mantenha os prazos de retenção.
- Pontuações são estimativas internas baseadas em evidências e não equivalem a avaliações oficiais de terceiros.

Créditos e licenças: [CREDITS.md](../CREDITS.md) e [LICENSE](../LICENSE) (kit, MIT) e [docs/fases/FASE-0-DIAGNOSTICO.md](docs/fases/FASE-0-DIAGNOSTICO.md) (dependências).
