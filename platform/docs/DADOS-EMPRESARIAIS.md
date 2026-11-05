# Dados empresariais (Econodata API v4)

Enriquecimento pago com cadastro oficial e estimativas de mercado, integrado à ficha, aos indicadores e à Análise Comercial com IA. Código em `platform/api/src/modules/company-data/`.

## Fornecedor e contrato

- **Fornecedor:** Econodata, API REST v4 ([documentação](https://econodata-tecnologia.github.io/api-v4-docs/), contrato `openapi.yaml`, conferido em 03/11/2026).
- **Autenticação:** `Authorization: Bearer ek_live_…`. Chaves `ek_test_` são recusadas (401) e chaves de teste (trial) são só de leitura.
- **Endpoints usados:**

| Uso | Endpoint | Cobrança |
|---|---|---|
| Identificar a empresa sem CNPJ | `POST /v4/companies/match` (`criterios`: nome, UF, site, telefone, e-mail) | Lista vazia é grátis; só o melhor candidato, quando confiante, é cobrado |
| Consulta completa | `POST /v4/companies/search` (`criterios.cnpj`, `incluir`) | Base + campos entregues; reconsultar a mesma empresa em 24 h não recobra |
| Saldo | `GET /v4/account/balance` | Nunca cobra |
| Prévia de custo | header `X-Estimate-Only: true` em qualquer endpoint de dados | Não cobra nem entrega dado |

- **Consumo real:** vem no header `X-Tokens-Charged` e fica registrado em `data_provider_calls`.
- **Limites do fornecedor:** 60 requisições por minuto por chave (rajada de 120), acima disso 429; saldo insuficiente é 402.
- **Não usados nesta fase:** `search_list` e `calc_list` (segmentação de mercado), tags, pesquisas salvas, `people` (decisores paginados) e `economic-group`.

## Fluxo

Coleta gratuita → identificação → validação → consulta paga seletiva:

1. **CNPJ já validado** (dígitos verificadores conferidos): consulta direta.
2. **Sem CNPJ:** `/match` com o site (domínio, sem os genéricos), telefone, e-mail, nome e UF, pedindo só o bloco `cadastro`.
3. **Vínculo automático** só quando tudo isto vale:
   - casou por identificador forte (CNPJ, site, telefone ou e-mail), não só por nome ou UF;
   - a confiança atinge o mínimo da conta (padrão 85%);
   - não há segundo candidato com diferença menor que 0,10;
   - o fornecedor entregou o cadastro;
   - UF e cidade batem.
4. **Fora disso:** a ficha mostra os candidatos (só identificação, sem dado pago) e uma pessoa confirma com "É esta". Nada é vinculado por semelhança de nome.
5. **Antes de cada chamada paga:** prévia de custo e limites da conta (tokens por consulta, consultas por dia, tokens por dia). Excedeu, a chamada não é feita.
6. **Repetição:** só para 429 e 503 (respeitando `Retry-After` ou `X-RateLimit-Reset`); 401, 402, 403, 404 e 422 não se repetem.
7. **Proteções da conta:** trava por empresa (sem consulta duplicada), limite de 50 por minuto por conta, cache pelo número de dias da conta e lote pela fila `company-data` com concorrência de `ECONODATA_MAX_CONCURRENT_REQUESTS` e 20 por minuto.
8. **Automático:** desligado por padrão. Quando ligado, depois de cada busca pega só as empresas novas com CNPJ ou site, até o limite por busca.

## Modelo interno

`BusinessProfile` (`types.ts`) é independente do fornecedor. Outro provedor entra com um cliente e um normalizador próprios.

Cada campo é um `DataPoint` com valor, natureza, fonte (fornecedor e bloco), data e nota:

| Natureza | Exemplos |
|---|---|
| Oficial | cadastro da Receita: razão social, situação, CNAEs, abertura, endereço, capital, enquadramento, regime |
| Declarado | faixa de funcionários ou faturamento com origem diferente de "Presumido" |
| Observado | comércio exterior (anos com registro, sem volume), recebimentos públicos, tecnologias, contatos |
| Estimado | faturamento e funcionários "Presumido", porte do fornecedor, tendência do setor |

- **Campo ausente:** fica ausente, e a tela mostra "Não disponível", nunca zero.
- **Sócios:** guarda-se só a quantidade; nomes e CPF não são armazenados.
- **Contatos e decisores:** só vêm se a conta liberar os blocos `contatosBasicos` e `contatosAvancados`, que ficam desligados por padrão (dados pessoais, LGPD), e nunca vão para a IA.
- **Na empresa:** quando a identificação é real (não simulada), o CNPJ (se faltava) e a razão social são gravados com procedência `ECONODATA`. Nada existente é sobrescrito.

## Indicadores e IA

- **Segmento:** o CNAE principal oficial passa a identificar o segmento quando a categoria não basta: 6821/6822 imobiliária, 6920 contabilidade, 6911 advocacia, 7311/7312/7319 agência.
- **Critérios novos** (metodologia `2026.11-ic2`): porte e equipe compatíveis (aderência), escala da operação (oportunidade) e cadastro oficial ativo (confiabilidade).
  - Só existem para empresas enriquecidas. Sem perfil, nem entram no peso total, e a nota fica igual à da metodologia anterior.
  - A faixa ideal de funcionários e os portes-alvo ficam em Configurações › Inteligência artificial › Perfil de cliente ideal.
- **CNPJ não ativo:** é problema confirmado (não ausência de dado), vira alerta e limita a prioridade a C.
- **Na IA (prompt `ic-2026.11.1`):** recebe `dados_empresariais` sem contatos nem pessoas e uma regra explícita: faixa é faixa, estimativa é estimativa, nada de inventar faturamento, funcionários ou exportações, e dado ausente não é problema.

## Configuração

- **Por conta**, em Configurações › Dados empresariais (só `settings:manage` altera):
  - ativação, desligada por padrão;
  - chave cifrada (AES-256-GCM, mesma tabela das chaves de IA, `provider = "econodata"`), validada pelo saldo, que não cobra;
  - blocos consultados, limites, cache, lote e automático.
- **Servidor (`.env`):** a chave nunca fica aqui.
  - `ECONODATA_BASE_URL`: padrão `https://api.econodata.com.br`.
  - `ECONODATA_MOCK_MODE`: Econodata simulada, sem chave nem rede; ignorada em produção.
  - `ECONODATA_MAX_CONCURRENT_REQUESTS`: padrão 2.

## Modo simulado e testes

- **O que é:** `econodata/mock.ts` implementa o contrato HTTP da v4 com dados sintéticos e determinísticos. Usa o mesmo cliente HTTP, então os testes exercitam o caminho real.
- **Cenários por palavra no nome ou site:** `ambigua`, `naoencontrada`, `indisponivel` (503), `limite` (429 uma vez), `semprelimite`, `outracidade`, `baixada`.
- **Cenários pela chave:** chave com `invalida` (401) e chave com `semsaldo` (402).
- **Isolamento:** perfis simulados ficam com `provider = "econodata-mock"`, aparecem como "Simulado" na ficha e nunca se misturam com os reais nem são gravados na empresa.
- **Testes:** `test/unit/company-data.test.ts` e `test/integration/company-data.test.ts`, que rodam no banco descartável com o modo simulado.

## Para ativar a API real

1. Contratar a API v4 com a Econodata (a liberação é feita por ela) e gerar a chave em plat.econodata.com.br › Chaves e Integrações.
2. Confirmar no contrato:
   - o valor do token e a tabela por campo (a documentação diz "em definição");
   - as regras de armazenamento e cache dos dados (o padrão aqui é reaproveitar por 30 dias);
   - o uso permitido de contatos e decisores.
3. Aplicar a migração `20261103120000_dados_empresariais` em produção, só com backup e pedido explícito.
4. Na conta: cadastrar a chave, conferir o saldo, ajustar os limites e ativar.
5. Fazer uma consulta real numa empresa com CNPJ conhecido e comparar com a estimativa (os limites padrão de tokens são conservadores e podem precisar de ajuste).
