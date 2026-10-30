# Inteligência comercial e Análise Comercial com IA

Esta parte do Prospecta vai além da coleta de empresas. Ela qualifica cada empresa com três indicadores calculados no próprio sistema, sem IA. Também gera, quando alguém pede, uma análise com IA para preparar a abordagem.

- Código: `platform/api/src/modules/intelligence/` (indicadores e análise) e `platform/api/src/modules/ai/` (provedores).
- Telas:
  - aba **Inteligência comercial** na ficha da empresa;
  - **Configurações › Inteligência artificial**.

## 1. Os três indicadores (metodologia `2026.10-ic1`)

Cada indicador vai de 0 a 100 e é calculado separadamente. A conta é a mesma da auditoria digital:

- **Resultado de cada critério:**
  - atende vale 100% do peso;
  - parcial vale 50%;
  - não atende vale 0%;
  - "não avaliado" sai da conta (nem soma, nem subtrai).
- **Nota:** 100 × pontos obtidos ÷ peso dos critérios avaliados.
- **Cobertura:** peso avaliado ÷ peso total. Abaixo de 50%, o indicador fica sem nota.
- **Evidências:** cada critério cita as evidências que usou. Dentro de um indicador, uma evidência pontua uma vez só.

### Aderência ao perfil (o quanto a empresa parece um cliente ideal)

| Critério | Peso | Como é avaliado |
|---|---|---|
| Segmento-alvo | 30 | A categoria (ou, na falta dela, o nome) indica um segmento marcado como alvo. |
| WhatsApp comercial | 20 | WhatsApp publicado em link no site oficial ou registrado manualmente. **Celular sozinho não conta.** |
| Outros canais | 20 | Telefone, e-mail, site no ar e redes sociais (3 ou mais = atende). |
| Movimento público | 15 | Avaliações no Google (30+ atende, 10+ parcial). Indica movimento, não tamanho de equipe. |
| Captação comercial | 15 | Chamada para ação no site, segundo a auditoria digital. |

### Oportunidade comercial (sinais de que o produto pode ser útil)

| Critério | Peso | Como é avaliado |
|---|---|---|
| Mais de um WhatsApp | 30 | 2 ou mais = atende; 1 = parcial (não se sabe quantos atendem por ele). |
| Outras linhas | 20 | Linhas que não são WhatsApp confirmado. Vários números **não** provam desorganização. |
| Canais de mensagem | 15 | E-mail, Instagram, Facebook. |
| Entradas de contato | 15 | Página de contato, botões de contato, agendamento ou pedidos pelo Google. |
| Necessidade do segmento | 20 | Sempre **parcial**: é hipótese de mercado, nunca fato sobre a empresa. |

As reclamações públicas não entram neste indicador. O Prospecta não coleta o texto das avaliações e não tem como verificá-las.

### Confiabilidade dos dados (o quanto dá para confiar no que foi coletado)

| Critério | Peso | Como é avaliado |
|---|---|---|
| Confirmação no site oficial | 25 | Algum contato coletado aparece no site oficial. Site bloqueado, fora do ar ou inexistente = não avaliado, **sem penalidade**. |
| Duas fontes | 20 | Um mesmo telefone aparece em duas fontes ou mais (sinal próprio, separado do número). |
| Atualidade | 15 | Até 90 dias atende; até 1 ano parcial. |
| Dados essenciais | 20 | Categoria, cidade, contato válido e endereço ou ficha pública. |
| Sem contradições | 10 | Cidade, UF, CNPJ, CEP e razão social não divergem entre fontes. |
| Coleta sem dados inválidos | 10 | Telefones impossíveis ou URL de site inválida. Site indisponível não conta aqui. |

### Prioridade consolidada

- **Média ponderada:** aderência 45, oportunidade 35, confiabilidade 20 (pesos normalizados).
- **Prioridade A:** média a partir de 70.
- **Prioridade B:** média a partir de 50.
- **Prioridade C:** abaixo de 50.
- **Necessita qualificação** quando:
  - algum indicador ficou sem nota;
  - não há nenhum contato válido;
  - ou a confiabilidade está abaixo de 40.

Segmentos-alvo, pesos dos indicadores e limites de A e B são definidos por conta, em Configurações › Inteligência artificial › Perfil de cliente ideal. Os pesos de cada critério ficam em `settings.intelligence.criteriaWeights`. O cálculo é determinístico: os mesmos dados e a mesma data dão o mesmo resultado.

## 2. Qualidade dos dados

- **Telefones:**
  - normalizados para E.164 (Brasil e exterior);
  - DDI validado, e DDD brasileiro conferido contra a lista da Anatel;
  - classificados pelo plano de numeração: fixo, celular, 0800 ou não identificado.
- **WhatsApp confirmado:** só quando há link publicado pela empresa ou registro manual. O fixo também pode ter WhatsApp.
- **Duplicidades:**
  - o mesmo número vindo de canais ou fontes diferentes vira um registro só, com a lista de origens;
  - empresas da mesma conta com o mesmo telefone, domínio ou nome na mesma cidade aparecem como possível duplicidade.
- **Observado ou inferido:** cada evidência informa se foi observada na fonte ou inferida, além da fonte e da data.
- **Sinais que não são usados como prova:**
  - celular não prova WhatsApp;
  - tag de anúncio ou de estatísticas não prova investimento em anúncios;
  - vários telefones não provam atendimento desorganizado.

## 3. Provedores de IA

São aceitos só estes cinco provedores, pelas APIs oficiais, sem intermediários. A especificação original previa quatro; a Groq entrou em 30/10/2026 por decisão explícita do cliente. Fontes conferidas em 29/10/2026 (Groq: 30/10/2026):

| Provedor | API | Saída estruturada | Modelo padrão |
|---|---|---|---|
| OpenAI | Responses API (SDK `openai` 7.33.0) | `text.format` json_schema estrito, `store: false` | `gpt-6.1-sol` |
| Anthropic (Claude) | Messages API (SDK `@anthropic-ai/sdk` 0.134.0) | `output_config.format` json_schema | `claude-opus-5-5` |
| xAI (Grok) | Responses API em `https://api.x.ai/v1` (SDK da OpenAI, como a xAI documenta) | `text.format` json_schema | `grok-4.7` |
| Google (Gemini) | Interactions API (SDK `@google/genai` 2.29.1) | `response_format` JSON + schema, `store: false` | `gemini-3.8-flash` |
| Groq | Chat Completions em `https://api.groq.com/openai/v1` (SDK da OpenAI, como a Groq documenta) | `response_format` json_schema estrito | `openai/gpt-oss-120b` |

- **Groq:** a Groq é outra empresa, sem relação com o Grok da xAI. As chaves dela começam com `gsk_` e são criadas em console.groq.com. Ela roda modelos abertos de terceiros. A saída estruturada estrita só funciona em alguns modelos (`openai/gpt-oss-120b`, `openai/gpt-oss-20b` e modelos em prévia; ver console.groq.com/docs/structured-outputs). A Responses API da Groq ainda é beta e não aceita `store`; por isso o adaptador usa o endpoint de chat.

- **Contrato comum:** todos implementam `AiProviderAdapter` (`modules/ai/types.ts`), com:
  - verificação de configuração;
  - lista de modelos (teste de conexão sem custo de tokens);
  - geração estruturada com timeout, cancelamento e registro de tokens.
- **Erros:** viram códigos comuns, como chave recusada, limite, timeout, modelo inexistente, recusa e resposta cortada. As mensagens passam por um filtro que remove qualquer coisa parecida com uma chave.
- **Claude:** nos modelos que aceitam, liga o `fallbacks: "default"` do próprio servidor da Anthropic para recusas. Continua sendo a Anthropic, e o modelo que respondeu fica registrado na análise.
- **Modelos padrão:** podem ser trocados por `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `XAI_MODEL`, `GEMINI_MODEL` e `GROQ_MODEL`, ou por conta, na tela.

### Chaves: administradas pela plataforma (por enquanto)

As chaves ficam só em variáveis de ambiente do servidor: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY` e `GROQ_API_KEY`. Elas nunca vão para o navegador, para os registros ou para o Git.

Cada conta (empresa cliente) escolhe os provedores, os modelos e os limites, mas usa as chaves da instalação. Chaves próprias de cada cliente (BYOK) não foram implementadas, porque exigem armazenamento cifrado e separado por conta, com rotação e revogação. O projeto já tem `encryptSecret` (AES-256-GCM, `lib/crypto.ts`), que pode servir de base quando isso for decidido.

### Escolha do provedor

- **Manual:** usa só o provedor principal (ou o que a pessoa escolher na ficha). Se falhar, a análise falha e nada é trocado.
- **Alternância automática:** se o principal falhar, tenta as alternativas que a conta marcou como autorizadas.
  - A ordem segue a prioridade ou o menor custo estimado.
  - Cada tentativa fica registrada e a tela mostra quem respondeu e por quê. Não há troca silenciosa.
- **Escolha na ficha:** quando a pessoa escolhe um provedor na ficha, vale só aquele, sem alternância.

### Custos

- **Preços:** a tabela fica em `modules/ai/pricing.ts`, com a data de conferência e a página oficial de cada preço. Os preços que o Google já anunciou que vão mudar expiram na data do aumento.
- **Custo desconhecido:** vale para modelo fora da tabela, preço vencido ou tokens não informados. Por padrão, modelos com custo desconhecido ficam bloqueados.
- **Antes da chamada:** o sistema estima o pior caso (entrada aproximada por caracteres ÷ 4, mais todo o limite de saída). A chamada é bloqueada se passar do limite por análise.
- **Depois da chamada:** grava os tokens informados pelo provedor e o custo. A xAI informa o custo na resposta, e o sistema usa esse valor.
- **Cache:** com os mesmos dados, o mesmo modelo e a mesma versão do prompt, a análise é reaproveitada por N dias, sem nova cobrança.
- **Proteções:**
  - trava de uma análise por empresa de cada vez (evita cobrança dupla);
  - limite de 20 pedidos por minuto;
  - tentativas extras só para erros temporários.

## 4. Análise Comercial com IA

Contrato validado no servidor (`analysis/schema.ts`, versão de prompt `ic-2026.10.2`), igual para todos os provedores:

- `summary`: resumo comercial;
- `verifiedFacts`: fatos com as evidências citadas (E1, E2…);
- `opportunityHypotheses`: hipóteses, com base e confiança;
- `diagnosticQuestions`: perguntas de diagnóstico;
- `personalizedMessage`: mensagem inicial;
- `possibleObjections`: objeções com resposta sugerida;
- `recommendedNextAction`: próxima ação, uma de:
  - verificar o responsável comercial;
  - qualificar a operação de atendimento;
  - solicitar uma conversa;
  - apresentar uma demonstração;
  - aguardar retorno;
  - encerrar o contato.
- `confidence`;
- `limitations`.

O registro guarda também:

- provedor e modelo que efetivamente responderam;
- data;
- tokens e custo;
- tentativas;
- evidências enviadas;
- a versão do prompt.

### Segurança e precisão

- **O que a IA recebe:** só dados já coletados e estruturados. Telefones, e-mails, @ de perfis e nomes de pessoas não são enviados.
- **Textos de sites:**
  - são higienizados e delimitados;
  - vão marcados como não confiáveis;
  - o prompt manda ignorar qualquer instrução que esteja neles.
- **Validação do servidor:**
  - um fato que cite uma evidência inexistente é retirado de "evidências verificadas";
  - uma mensagem que traga telefone, e-mail ou link ganha alerta de revisão.
- **Uso da mensagem:** a mensagem pode ser editada e salva. A sugestão original continua guardada. Nada é enviado automaticamente: a pessoa copia e envia.
- **O que a IA não faz:** não executa comandos e não grava no banco a partir do conteúdo analisado.

## 5. Segmentos

Os perfis de imobiliária, contabilidade, advocacia e agência de marketing ficam em `modules/intelligence/segments.ts`. Cada perfil traz termos de identificação, hipóteses gerais de mercado e perguntas de diagnóstico. Para incluir um segmento novo, basta acrescentar um item na lista; o motor e o prompt já o leem.

## 6. Testes isolados

Os testes de integração e o desenvolvimento local da IA usam um Postgres e um Valkey descartáveis:

- **Arquivo:** `platform/compose.teste-isolado.yaml`.
- **Isolamento:** projeto Compose separado, dados em memória, portas 55432 e 56379.
- **Segredos:** gerados na hora. As chaves de IA ficam sempre vazias.

```bash
node platform/scripts/teste-isolado.mjs up
```

```bash
npm --prefix platform/api test
```

```bash
node platform/scripts/teste-isolado.mjs down
```

**Trava de segurança (`test/integration/db-guard.ts`):** os testes só migram ou limpam um banco local marcado com `COMMENT ON DATABASE … IS 'prospecta:descartavel'`. Bancos de desenvolvimento e produção não têm a marca. O `scripts/dev-isolado.mjs` (API na porta 4100, site na 3100) faz a mesma checagem antes de subir.

## 7. Produção

1. **Backup manual do banco** antes de atualizar: a API aplica as migrações sozinha ao subir (`api/docker-entrypoint.sh`).
2. **Migração:** `20261029200000_analise_comercial_ia` só cria a tabela `ai_analyses` e um enum, sem alterar dados.
3. **Chaves:** o serviço `platform-api` de `deploy/prospecta-stack.yaml` (e de `compose.yaml`) recebe `OPENAI_*`, `ANTHROPIC_*`, `XAI_*`, `GEMINI_*` e `GROQ_*` do `.env` do servidor; o worker não recebe nenhuma. Depois de pôr a chave no `.env`, rode de novo `sh platform/deploy/swarm-deploy.sh`.
4. **Ativação por conta:** a IA chega desligada em todas as contas. Ative em Configurações › Inteligência artificial, de preferência primeiro só na conta da própria plataforma: as chaves são da instalação, então o uso de qualquer conta entra na mesma fatura do provedor.
5. **Provedores testados de verdade:** só a Groq (30/10/2026, `openai/gpt-oss-120b`, US$ 0,0015 a 0,0017 por análise). Os outros quatro passaram só por testes com respostas simuladas; deixe-os sem chave até um teste real.
