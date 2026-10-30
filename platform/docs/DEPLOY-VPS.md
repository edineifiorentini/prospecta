# Prospecta numa VPS (24 horas, domínio e HTTPS)

Este guia coloca o Prospecta inteiro numa VPS com Docker: web, API, worker, banco, filas, motor do Google Maps e WhatsApp.
Só o **Caddy** fica exposto na internet (portas 80 e 443), com certificado HTTPS automático do Let's Encrypt. Todo o resto
conversa apenas pela rede interna do Docker.

A configuração de produção está em [`compose.prod.yaml`](../../compose.prod.yaml), [`platform/deploy/Caddyfile`](../deploy/Caddyfile)
e [`platform/deploy/realip.conf`](../deploy/realip.conf). No seu computador nada muda: sem esses ajustes no `.env`, tudo continua em
`http://localhost:3000`.

> **O servidor já tem Traefik e Docker Swarm** (instalações com Portainer, Evolution API, n8n etc.)? As portas 80 e 443 já
> são do Traefik: use a seção [Servidor que já usa Traefik e Docker Swarm](#servidor-que-já-usa-traefik-e-docker-swarm) no
> fim deste guia, e não o Caddy.

## Antes de começar

| Item | Recomendação | Por quê |
|---|---|---|
| Processador | **x86 (amd64)** | o motor do Google Maps só é publicado para amd64. VPS ARM não serve |
| Memória | **8 GB** (mínimo 4 GB com 4 GB de swap) | o worker usa ~1,5 GB com o Chrome das auditorias, e o motor abre outro Chrome durante as buscas |
| Disco | **80 GB ou mais** | as imagens Docker ocupam ~8 GB e cada atualização gera imagens novas |
| Sistema | **Ubuntu 24.04 LTS** | os comandos abaixo foram escritos para ele |
| Região | **São Paulo**, se o provedor tiver | menor latência e dados no Brasil (LGPD) |
| Domínio | um domínio ou subdomínio seu | exemplo: `prospecta.seudominio.com.br` |

> **Atenção às buscas no Google Maps.** O Google bloqueia com mais frequência buscas vindas de IPs de data center do que de
> internet residencial. Na VPS, prefira buscas menores e espaçadas. Se uma busca falhar por bloqueio, aguarde: o Prospecta
> não contorna CAPTCHA nem bloqueios.

## 1. Contratar a VPS

1. Escolha Ubuntu 24.04, processador x86/AMD e, se houver, a região São Paulo.
2. Na criação, cadastre a sua **chave SSH** (no Windows: `ssh-keygen -t ed25519` no PowerShell e cole o conteúdo de
   `C:\Users\<você>\.ssh\id_ed25519.pub`). Evite acesso por senha.
3. Anote o **IP público** da VPS.
4. Se o provedor tiver um firewall próprio no painel, libere apenas as portas **22, 80 e 443** (TCP) e **443 (UDP)**.

## 2. Apontar o domínio

No painel do seu domínio (Registro.br, Cloudflare, Hostinger etc.), crie um registro:

| Tipo | Nome | Valor |
|---|---|---|
| A | `prospecta` (ou `@` para o domínio raiz) | IP da VPS |

Se usar Cloudflare, deixe o registro como **"DNS only"** (nuvem cinza) até o certificado sair. Confira a propagação no seu computador:

```bash
nslookup prospecta.seudominio.com.br
```

## 3. Preparar o servidor

Entre como `root` (primeiro acesso):

```bash
ssh root@IP_DA_VPS
apt update && apt -y upgrade
apt install -y git unattended-upgrades ufw
```

Crie um usuário para o dia a dia e copie a sua chave SSH para ele:

```bash
adduser prospecta
usermod -aG sudo prospecta
rsync --archive --chown=prospecta:prospecta ~/.ssh /home/prospecta
```

Firewall (só SSH, HTTP e HTTPS):

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
```

> O Docker abre as portas que publica sem passar pelo `ufw`. Em produção, só o Caddy publica portas (80 e 443), então o banco,
> as filas, o motor e o WhatsApp continuam fechados.

Docker (script oficial) e Node.js 24 (usado pelos scripts de backup):

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker prospecta
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
```

Se a VPS tiver **4 GB** de memória, crie 4 GB de swap:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Teste o acesso com o novo usuário **em outra janela** antes de fechar a sessão de root: `ssh prospecta@IP_DA_VPS`.
Depois, desative o login por senha e o acesso direto de root:

```bash
printf 'PasswordAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/90-prospecta.conf
systemctl restart ssh
```

## 4. Baixar o código

O repositório é público desde 30/10/2026: não precisa de login nem de chave. Conectado como `prospecta`:

```bash
git clone -b feat/plataforma-prospeccao https://github.com/edineifiorentini/prospecta.git ~/prospecta
cd ~/prospecta
```

Se o repositório voltar a ser privado, use uma **chave de implantação** (só leitura): gere com
`ssh-keygen -t ed25519 -C "vps-prospecta" -f ~/.ssh/prospecta_deploy -N ""`, cadastre o conteúdo de `~/.ssh/prospecta_deploy.pub`
em **prospecta → Settings → Deploy keys → Add deploy key** (sem marcar "Allow write access") e clone com
`git clone -c core.sshCommand="ssh -i ~/.ssh/prospecta_deploy" -b feat/plataforma-prospeccao git@github.com:edineifiorentini/prospecta.git ~/prospecta`.

(Quando a branch `feat/plataforma-prospeccao` for unida à `master`, troque o `-b` por `master`.)

## 5. Configurar o `.env`

```bash
node platform/scripts/init-env.mjs
nano .env
```

O script gera senhas e chaves novas e fortes. Ajuste estas linhas:

```dotenv
APP_BASE_URL=https://prospecta.seudominio.com.br
COOKIE_SECURE=true
DOMAIN=prospecta.seudominio.com.br
ACME_EMAIL=seu-email@exemplo.com
```

E acrescente, em qualquer lugar do arquivo, a linha que liga a configuração de produção em todos os comandos `docker compose`:

```dotenv
COMPOSE_FILE=docker-compose.yml:compose.prod.yaml
```

Se for **levar os dados do seu computador** (passo 7), copie também o valor de `APP_ENCRYPTION_KEY` do `.env` do computador
para o `.env` do servidor. É a chave que protege os tokens do WhatsApp. Transfira por SSH/arquivo, nunca por chat ou e-mail.

**E-mail (recuperação de senha e convites):** em produção, o Mailpit só guarda as mensagens internamente. Para que os e-mails
cheguem de verdade, configure um SMTP (do seu domínio ou de um serviço de envio):

```dotenv
SMTP_URL=smtps://usuario:senha@smtp.seuprovedor.com:465
MAIL_FROM=Prospecta <no-reply@seudominio.com.br>
```

Proteja o arquivo: `chmod 600 .env`.

## 6. Subir o Prospecta

```bash
docker compose up -d --build
docker compose ps
```

A primeira compilação leva alguns minutos. Quando todos os serviços estiverem `healthy`, abra
`https://prospecta.seudominio.com.br`. O Caddy emite o certificado na primeira visita, em poucos segundos, se o domínio já
aponta para a VPS. Para acompanhar: `docker compose logs -f caddy`.

## 7. Seus dados: levar ou começar do zero

**Levar os dados do computador** (empresas, CRM, buscas, seu usuário e senha):

No **computador** (pasta do projeto):

```bash
node platform/scripts/backup.mjs
scp platform/backups/prospecta-AAAAMMDD-HHMMSS.* prospecta@IP_DA_VPS:~/prospecta/platform/backups/
```

(Crie a pasta antes no servidor, se ainda não existir: `mkdir -p ~/prospecta/platform/backups`.)

No **servidor**:

```bash
node platform/scripts/restore.mjs platform/backups/prospecta-AAAAMMDD-HHMMSS.dump
node platform/scripts/restore.mjs platform/backups/prospecta-AAAAMMDD-HHMMSS.dump --apply --yes
```

O primeiro comando só confere o backup, e o segundo substitui o banco do servidor. Depois, entre com o mesmo e-mail e senha
de sempre. O WhatsApp precisa ser conectado de novo pelo QR Code em **Configurações → WhatsApp**.

**Começar do zero:** crie o primeiro administrador pelo terminal do servidor. A senha temporária é exibida uma única vez e
será trocada no primeiro acesso:

```bash
docker compose exec platform-api node dist/cli/owner.js --email voce@exemplo.com --name "Seu Nome"
```

## 8. Backups automáticos

Backup diário às 3h, mantendo os 14 mais recentes:

```bash
crontab -e
```

```cron
0 3 * * * cd /home/prospecta/prospecta && /usr/bin/node platform/scripts/backup.mjs --keep 14 >> /home/prospecta/backup.log 2>&1
```

Backups que ficam só na própria VPS não protegem contra a perda do servidor. Baixe uma cópia periodicamente para o seu
computador (`scp prospecta@IP_DA_VPS:~/prospecta/platform/backups/* .`) ou use o backup/snapshot pago do provedor.
Os arquivos contêm dados pessoais (telefones e e-mails): guarde em local protegido.

## 9. Atualizar a versão

```bash
cd ~/prospecta
git pull
docker compose up -d --build
docker image prune -f
```

As migrações do banco são aplicadas sozinhas quando a API reinicia. Faça um backup antes de atualizar.

## 10. Conferências e problemas comuns

| Sintoma | O que verificar |
|---|---|
| O certificado não sai | O domínio aponta para o IP certo (`nslookup`)? As portas 80 e 443 estão liberadas também no firewall do painel do provedor? Veja `docker compose logs caddy` |
| Erro 502 | `docker compose ps`: a API ou o web caíram? Veja `docker compose logs platform-api` |
| Login não mantém a sessão | `APP_BASE_URL` precisa ser exatamente `https://seu-dominio` e `COOKIE_SECURE=true` |
| Lentidão ou serviços reiniciando | memória: `free -h`. Com 4 GB, crie swap (passo 3) ou aumente o plano |
| Buscas falhando com bloqueio | o Google limitou o IP da VPS: aguarde e faça buscas menores |
| E-mails de recuperação de senha não chegam | sem `SMTP_URL` real, eles ficam presos no Mailpit interno (passo 5) |

## Servidor que já usa Traefik e Docker Swarm

Em servidores montados com Portainer + Traefik no Docker Swarm, o Prospecta entra como mais uma stack
([`platform/deploy/prospecta-stack.yaml`](../deploy/prospecta-stack.yaml)):

- não publica porta nenhuma: o Traefik existente recebe o domínio, emite o certificado e entrega ao gateway pela rede dele;
- banco, filas, motor do Google Maps e WhatsApp ficam em redes próprias da stack, longe das outras aplicações;
- cada serviço tem limite de memória (cerca de 5,6 GB no máximo somando todos; o uso normal fica em torno de 2,5 GB);
- tem banco próprio (Postgres 17), separado de qualquer Supabase ou Postgres que já exista no servidor;
- nenhuma outra stack, nem o Traefik, é alterada.

**Antes:** descubra a rede e o certresolver do Traefik (como root):

```bash
docker service inspect traefik_traefik --format '{{range .Spec.TaskTemplate.ContainerSpec.Args}}{{println .}}{{end}}' | grep -E 'certificatesresolvers|network'
```

**Passo a passo** (como root):

1. Swap de 4 GB, se o servidor não tiver (`swapon --show` vazio):

   ```bash
   fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   echo 'vm.swappiness=10' > /etc/sysctl.d/90-prospecta-swap.conf && sysctl -p /etc/sysctl.d/90-prospecta-swap.conf
   ```

2. Código com chave de implantação (veja o passo 4 do guia), na pasta `/opt/prospecta`.

3. `.env` sem precisar instalar o Node no servidor:

   ```bash
   cd /opt/prospecta
   docker run --rm -v /opt/prospecta:/w -w /w node:24-alpine node platform/scripts/init-env.mjs
   chmod 600 .env
   ```

   Ajuste no `.env`:

   ```dotenv
   APP_BASE_URL=https://prospecta.seudominio.com.br
   COOKIE_SECURE=true
   DOMAIN=prospecta.seudominio.com.br
   PROSPECTA_DIR=/opt/prospecta
   TRAEFIK_NETWORK=nome-da-rede-do-traefik
   TRAEFIK_CERTRESOLVER=nome-do-certresolver
   ```

4. Compile as imagens e suba a stack:

   ```bash
   docker compose build platform-api platform-web
   sh platform/deploy/swarm-deploy.sh
   docker stack services prospecta
   ```

   A stack aparece também no Portainer, como as outras.

5. Dados do computador: gere o backup no computador (`node platform/scripts/backup.mjs`), copie o `.dump` e o `.sha256`
   para `/opt/prospecta/platform/backups/` e restaure:

   ```bash
   sh platform/deploy/swarm-restore.sh platform/backups/prospecta-AAAAMMDD-HHMMSS.dump --yes
   ```

   Para começar do zero, crie o administrador:
   `docker exec -it $(docker ps -q -f name=prospecta_platform-api) node dist/cli/owner.js --email voce@exemplo.com --name "Seu Nome"`

6. Backup diário às 3h, mantendo os 14 mais recentes (`crontab -e`):

   ```cron
   0 3 * * * sh /opt/prospecta/platform/deploy/swarm-backup.sh 14 >> /var/log/prospecta-backup.log 2>&1
   ```

**Atualizar:** `cd /opt/prospecta && git pull && docker compose build platform-api platform-web && sh platform/deploy/swarm-deploy.sh`.
Como as imagens mantêm o mesmo nome, force a troca dos contêineres em seguida:
`docker service update --force prospecta_platform-api && docker service update --force prospecta_platform-worker && docker service update --force prospecta_platform-web`.

**Remover o Prospecta do servidor** (as outras stacks não são afetadas): `docker stack rm prospecta`. Os volumes com os dados
(`prospecta_pgdata` e demais) continuam no disco até serem apagados manualmente.
