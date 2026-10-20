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

## Motor do Google Maps (opcional)

- Contraria os Termos do Google; prefira o OpenStreetMap.
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
