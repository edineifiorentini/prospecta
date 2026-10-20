# Manutenção e operação

Todos os comandos rodam na raiz do repositório (`D:\Desktop\SCRAPPER MAPS`).

## Rotina recomendada

| Quando | O quê |
|---|---|
| Diariamente (automático, 03:00) | Retenção: limpa dados brutos de coleta, empresas arquivadas antigas, trilha de auditoria e eventos de webhook vencidos, sessões e tokens expirados. Os prazos ficam em Configurações → Organização. |
| Diariamente | `node platform/scripts/backup.mjs --keep 14`. No Windows, pode ser agendado no Agendador de Tarefas. |
| Semanalmente | Verifique o backup mais recente com `node platform/scripts/restore.mjs <arquivo.dump>`, que não altera nada. |
| Mensalmente | Revise usuários e perfis, a trilha de auditoria (Configurações → Trilha de auditoria) e os pedidos de titulares. |

## Recuperar o acesso

Se ninguém consegue entrar (senha esquecida sem acesso ao e-mail, conta bloqueada):

```bash
docker compose exec platform-api node dist/cli/owner.js --email voce@exemplo.com --name "Seu Nome"
```

O comando cria ou recupera o usuário como Proprietário, gera uma senha temporária (impressa no terminal), desbloqueia a conta e encerra as sessões abertas. A troca da senha é exigida no próximo login.

Para gravar a senha num arquivo em vez de imprimir, acrescente `--out /tmp/acesso.txt` e copie o arquivo com `docker compose cp`.

## Atualizar a plataforma

```bash
node platform/scripts/backup.mjs
git pull
docker compose up -d --build
```

Faça primeiro o backup e depois traga as alterações; o último comando aplica as migrações automaticamente.

Depois de atualizar:

- confira com `docker compose ps` (todos os serviços `healthy`);
- abra http://localhost:3000/api/health;
- rode a suíte ponta a ponta: `cd platform/e2e && npx playwright test`.

### Dependências

- Versões fixadas nos `package.json` e nos `Dockerfile`.
- Antes de subir versões, rode `npm audit --omit=dev` em `platform/api` e `platform/web` e os testes.
- O npm 11 bloqueia scripts de instalação não aprovados (`allowScripts` no `package.json`); aprove só pacotes conhecidos.
- Imagens de terceiros:
  - `postgres:17-alpine`, `valkey/valkey:8-alpine`, `axllent/mailpit:v1.31.4`, `asternic/wuzapi:1.0.9`, `nginx:1.30-alpine`, `gosom/google-maps-scraper:v1.18.1`;
  - bases `mcr.microsoft.com/playwright:v1.64.1-noble` e `node:24-bookworm-slim`.
- Ao trocar a versão do Playwright na API, troque também a imagem base e a versão em `platform/e2e`.
- **Grandes versões do PostgreSQL** exigem backup e restauração: o volume não é compatível entre versões.

## Segredos

- Os segredos ficam no `.env` (gerado por `init-env.mjs`). Nunca o envie para repositórios.
- Para trocar `POSTGRES_PASSWORD` com dados existentes, altere a senha no banco (`ALTER USER`) **antes** de mudar o `.env`.
- Trocar `APP_ENCRYPTION_KEY` invalida os tokens do WhatsApp guardados: será preciso recriar a instância e ler o QR Code de novo.
- Trocar `SESSION_SECRET` ou `VALKEY_PASSWORD` só exige `docker compose up -d` (as sessões continuam válidas porque ficam no banco).

## WhatsApp (WuzAPI)

Use apenas números de teste autorizados.

**Conectar ou reconectar.** Em Configurações → WhatsApp → Reconectar, leia o QR Code com o celular (WhatsApp → Aparelhos conectados). O QR Code expira em cerca de um minuto; depois disso, clique em Reconectar de novo.

**Status "Desconectado" ou "Erro".** Veja `docker compose logs wuzapi platform-worker`. O status é verificado a cada minuto.

**Webhooks.**

- Chegam pela rede interna em `platform-api:4000/api/webhooks/wuzapi`, assinados com HMAC.
- Eventos sem assinatura válida são recusados. A plataforma reaplica a chave HMAC na instância quando necessário (comportamento do WuzAPI 1.0.9).

**Mudar de número.** Clique em Encerrar sessão e depois em Reconectar com o novo aparelho.

**Uso comercial em escala.** Migre para a WhatsApp Business Cloud API (adaptador `messaging/cloud-api.ts`), com modelos aprovados pela Meta.

## Mapa do Google (opcional)

Sem chave, a plataforma usa o mapa do OpenStreetMap. Com chave, usa o mapa visual do Google e **volta sozinha** para o OpenStreetMap se o Google recusar a chave, se a cota do dia acabar ou se não houver conexão (um aviso aparece no canto do mapa).

**Custo:** a Maps JavaScript API tem 10.000 carregamentos de mapa grátis por mês (depois, US$ 7 por 1.000); a Geocoding API tem 10.000 consultas grátis por mês (depois, US$ 5 por 1.000). Cada abertura de uma tela com mapa conta 1 carregamento; mover o mapa e dar zoom não contam. O Google exige conta de faturamento com cartão mesmo dentro da faixa gratuita.

**Configuração (Google Cloud Console):**

1. Crie um projeto e vincule uma conta de faturamento.
2. Ative a **Maps JavaScript API** e, se quiser localizar as cidades pelo Google, a **Geocoding API**.
3. Crie a **chave do mapa** (Credenciais → Chave de API) e restrinja:
   - **Sites**: `http://localhost:3000/*` e `http://127.0.0.1:3000/*`;
   - **APIs**: só a Maps JavaScript API.
4. Opcional: crie uma **segunda chave, para o servidor**, restrita só à Geocoding API. Ela não pode ter restrição por site, porque é usada pela API da plataforma, não pelo navegador.
5. Opcional: em **Gerenciamento de mapas**, crie um **ID de mapa** (JavaScript, vetorial). Sem ele a plataforma usa `DEMO_MAP_ID`, que o Google libera para testes.
6. Em cada API, aba **Cotas**, limite o uso diário (ex.: 300 carregamentos de mapa e 100 geocodificações por dia) para nunca passar da faixa gratuita.
7. Em **Faturamento → Orçamentos e alertas**, crie um alerta de valor baixo.

**Na plataforma:** preencha no `.env` da raiz e aplique com `docker compose up -d`:

```
GOOGLE_MAPS_API_KEY=chave-do-mapa
GOOGLE_MAPS_MAP_ID=id-do-mapa          # opcional
GOOGLE_GEOCODING_API_KEY=chave-servidor # opcional
```

A chave do mapa fica visível no navegador (é assim que o Google funciona); a restrição por site é o que a protege. A plataforma só a entrega a usuários logados. Coordenadas obtidas do Google ficam em cache por no máximo 30 dias, conforme os termos do Google Maps Platform.

## Localização das cidades

As buscas usam serviços públicos e gratuitos, que às vezes ficam instáveis.

| Serviço | Para que serve | Se estiver fora do ar |
|---|---|---|
| Nominatim | Achar o centro da cidade ou do bairro | A plataforma tenta o Photon (`PHOTON_URL`), que também usa dados do OpenStreetMap |
| Photon | Reserva do Nominatim | Como no kit original, a busca segue pelo nome do local: no Google Maps o lugar vai no texto ("escola em Umuarama, PR"); no OpenStreetMap a área vem do limite oficial do município (mais lento) |
| Overpass (só se o OpenStreetMap for reativado como fonte) | Consultar estabelecimentos no OpenStreetMap | Tenta 4 vezes, alternando entre overpass-api.de, overpass.private.coffee e overpass.kumi.systems; se todos falharem, use **Repetir** mais tarde ou faça a busca pelo Google Maps |

O formulário de busca mostra um aviso amarelo quando o mapa não localiza o lugar, mas a busca não é bloqueada.

## Motor do Google Maps (opcional)

- É a fonte de busca padrão. A raspagem contraria os Termos do Google: use com moderação.
- Volumes altos ou buscas seguidas podem bloquear temporariamente o IP. Use limites pequenos, uma busca por vez e, se necessário, proxies.
- Para desligar, defina `GMAPS_SCRAPER_ENABLED=false` no `.env` e rode `docker compose up -d`.
- A plataforma remove do motor o job de cada busca concluída.

## Diagnóstico de problemas

| Sintoma | Verificar |
|---|---|
| Página não abre | `docker compose ps`; `docker compose logs platform-gateway platform-web` |
| Erro 502 no gateway | API ou web reiniciando; aguarde o `healthy` ou veja `docker compose logs platform-api` |
| Buscas ou auditorias paradas em "Na fila" | `docker compose logs platform-worker`; o worker precisa estar `healthy`. Jobs sem andamento são marcados como falha automaticamente (buscas após 90 min, auditorias após 45 min, enriquecimentos após 30 min). |
| PDF indisponível | Só funciona na pilha Docker (o Chromium está na imagem da API) |
| E-mails de recuperação não chegam | Abra o Mailpit em http://localhost:8025; para envio real, ajuste `SMTP_URL` e `MAIL_FROM` |
| Integração sem conexão (testes) | Suba os serviços com `platform/compose.devports.yaml` e gere o `.env.dev` (`node platform/scripts/dev-env.mjs`) |

## Pedidos de titulares (LGPD)

Em Configurações → Privacidade, informe o e-mail ou telefone.

| Ação | O que acontece |
|---|---|
| Localizar | Mostra onde o dado aparece |
| Exportar (JSON) | Atende ao direito de acesso |
| Excluir dados | Remove contatos, conversas, autorizações e dados brutos; troca menções por "[removido]"; por padrão, mantém o identificador na lista de bloqueio para que não seja coletado nem contatado de novo |

A trilha de auditoria registra cada ação apenas com o hash do identificador. Retirar alguém da lista de bloqueio exige justificativa e fica registrado.
