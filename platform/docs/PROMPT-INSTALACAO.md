# Prompt de instalação do Prospecta

Copie o texto abaixo e cole no seu assistente de código (Claude Code ou similar), aberto na pasta onde o projeto vai ficar.

---

Você vai instalar o **Prospecta**, uma plataforma de prospecção B2B e CRM que roda inteira em Docker. Trabalhe em português do Brasil e explique cada passo antes de executar.

**Código:** repositório público https://github.com/edineifiorentini/prospecta. O Prospecta está na branch `feat/plataforma-prospeccao` (a `master` ainda é o kit original, sem a plataforma). Não precisa de login, senha nem chave. Clone com:

```bash
git clone -b feat/plataforma-prospeccao https://github.com/edineifiorentini/prospecta.git prospecta
```

Para atualizar depois: `git pull`, dentro da pasta `prospecta`.

**Antes de instalar, leia:** `CLAUDE.md`, `platform/README.md`, `platform/docs/DEPLOY-VPS.md` e `platform/docs/MANUTENCAO.md`. Siga esses guias; não improvise outra forma de instalar.

**Pergunte onde vai rodar e siga o guia certo:**
- **Computador local (Windows/Mac/Linux com Docker Desktop):** `platform/README.md`, seção "Primeira execução". Fica em `http://localhost:3000`.
- **VPS nova (Ubuntu 24.04, x86/amd64, 8 GB de RAM, 80 GB de disco):** `platform/docs/DEPLOY-VPS.md`, passos 1 a 8, com Caddy e HTTPS automático. Precisa de um domínio apontado para a VPS.
- **VPS que já tem Traefik e Docker Swarm (Portainer, n8n, Evolution etc.):** `platform/docs/DEPLOY-VPS.md`, seção "Servidor que já usa Traefik e Docker Swarm". Não mexa nas outras stacks do servidor.

**Regras obrigatórias:**
1. Gere segredos próprios com `node platform/scripts/init-env.mjs`. Nunca peça nem reutilize o `.env`, senhas, chaves ou backups de outra instalação.
2. O `.env` nunca vai para o Git. Proteja com `chmod 600 .env` no servidor.
3. Não faça commit nem push no repositório original. Para guardar mudanças suas, use um repositório seu (um fork, por exemplo).
4. Não exponha à internet o banco, o Valkey, o WuzAPI nem o motor do Google Maps. Só o gateway (local) ou o Caddy/Traefik (VPS) ficam acessíveis.
5. Depois do primeiro uso, a `APP_ENCRYPTION_KEY` do `.env` não pode mudar: ela protege os tokens do WhatsApp e as chaves de IA cadastradas pelas contas. Guarde uma cópia segura dela.
6. Não digite nem peça senhas ou chaves de API por mim. Quando precisar de uma, me diga onde colocar e eu coloco.
7. Chaves de IA (OpenAI, Claude, Grok, Gemini, Groq) não vão no `.env`: cada conta cadastra a própria em Configurações › Inteligência artificial.
8. As buscas no Google Maps usam raspagem: contrariam os Termos do Google e podem bloquear o IP por um tempo. Nos testes, use buscas pequenas e espaçadas. Não tente contornar CAPTCHA nem bloqueios.

**Primeiro acesso:** abra `/setup` e informe o `ADMIN_BOOTSTRAP_TOKEN` do `.env` (só funciona enquanto não existe nenhum usuário). Quem criar esse primeiro acesso vira o administrador da plataforma: cria as contas de clientes em Configurações › Contas e define os limites de pesquisa de cada uma.

**Conferências antes de dizer que terminou:**
- `docker compose ps` (ou `docker stack services prospecta`, no Swarm) com todos os serviços saudáveis;
- `/api/health` respondendo `{"ok":true,...}`;
- login funcionando e uma busca pequena de teste (por exemplo, até 10 empresas) concluída;
- backup diário configurado (guia da VPS, passo 8) e um backup manual feito e conferido.

**No final, me entregue um resumo com:** endereço de acesso, onde está o `.env` e como guardar a cópia da `APP_ENCRYPTION_KEY`, comandos para iniciar, parar, ver logs, atualizar e fazer backup, e o que ficou pendente.
