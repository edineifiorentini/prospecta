# Fontes públicas e gratuitas

O Prospecta complementa a coleta com dados abertos oficiais e APIs gratuitas. Tudo fica em
`platform/api/src/modules/public-data` (camada "CompanyIntelligence") e é configurado por conta em
**Configurações › Integrações**. Cada fonte começa **desligada**; as exceções são a BrasilAPI e o Lighthouse local,
que o Prospecta já usava e continuam ligados. Qualquer fonte pode ficar desligada sem afetar o resto do sistema.

## Regras que valem para todas

- **Dado da empresa × dado do município.** IBGE, Comex Stat e CAGED são estatísticas do município. Aparecem só na aba
  *Indicadores regionais*, com ano de referência e tabela, e nunca viram dado de uma empresa.
- **Vínculo só por identificador válido.** Registros públicos (Portal da Transparência, CVM) só são ligados pelo CNPJ
  exato. Na base local da Receita, empresa sem CNPJ só é vinculada por telefone ou domínio iguais, na mesma UF/cidade.
  Semelhança de nome gera apenas candidatos, que uma pessoa confirma.
- **Natureza do dado.** Cada valor guarda fonte, data e natureza (oficial, declarado, observado ou estimado).
  A ficha mostra "Não disponível", nunca zero, quando o dado não existe.
- **Nada é inventado.** Tecnologia não detectada não vira achado. Um registro de sanção não significa, sozinho, que a
  empresa é irregular, e nada é bloqueado automaticamente.
- **Custos.** Nenhuma fonte desta camada é paga. Os limites protegem o IP do servidor e as cotas gratuitas:
  - por minuto, global, imposto pelo Prospecta abaixo do limite de cada fonte;
  - por dia, por conta, configurável;
  - cache por fonte (consultas iguais ao mesmo tempo viram uma só);
  - nova tentativa com espera só em 429 ou indisponibilidade.
- **Registro.** Cada execução fica em `integration_runs` (sucesso, falha, código do erro, duração, se foi simulada),
  sem chave e sem dado pessoal. A central mostra a última execução, a última com sucesso, os erros recentes e o uso
  do dia.
- **Chaves gratuitas** (Portal da Transparência, PageSpeed): cada conta cadastra a sua. Ela fica cifrada no banco
  (AES-256-GCM) e nunca volta ao navegador nem aos registros.
- **Modo simulado:** `PUBLIC_DATA_MOCK_MODE=true`, ligado nos testes e no ambiente isolado. As fontes respondem nos
  mesmos caminhos e formatos das APIs reais, sem rede. É ignorado em produção, e o dado simulado fica separado do real
  (`pncp-mock`, `transparencia-mock`, chaves `mock:` no cache).

## Fontes

| Fonte | O que entrega | Acesso | Situação |
|---|---|---|---|
| Receita (BrasilAPI) | Confere o CNPJ publicado no site | API sem cadastro | já existia |
| Lighthouse local | Desempenho, SEO, acessibilidade (celular) | Chromium no servidor | já existia |
| PageSpeed Insights | Lighthouse remoto (celular e computador) e dados reais do Chrome (INP, LCP, CLS) | chave gratuita do Google | implementada, validada só com simulado |
| Receita (dados abertos) | Cadastro oficial: situação, CNAE, abertura, natureza, capital, matriz/filiais | arquivos importados | implementada, validada com amostra sintética |
| PNCP | Radar de contratações publicadas e com propostas abertas | API sem cadastro | implementada; API real conferida |
| Portal da Transparência | CEIS, CNEP e contratos federais pelo CNPJ | token gratuito | implementada, validada só com simulado |
| IBGE | População, PIB, CEMPRE (unidades locais e pessoal por seção CNAE) | API sem cadastro | implementada; API real conferida |
| Comex Stat | Exportações e importações do município (FOB US$, kg, produtos, países) | API sem cadastro | implementada; API real conferida |
| Novo CAGED | Admissões, desligamentos e saldo por município e seção | arquivos importados | implementada, validada com amostra sintética |
| CVM | Contas principais da DFP de companhias abertas | arquivos importados | implementada, validada com amostra sintética |
| Instagram (API oficial) | Bio, site, seguidores e posts de perfis comerciais/criador; WhatsApp, telefone, e-mail e site extraídos da bio | token da Meta + conta comercial | implementada, validada só com simulado |

Endpoints conferidos em 03/11/2026, só com parâmetros públicos (município, UF, datas):

- **IBGE:**
  - `servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios`;
  - `/api/v3/agregados/{tabela}/periodos/-1/variaveis/{v}?localidades=N6[{código}]`, com as tabelas 6579 (população),
    5938 (PIB), 9509 (CEMPRE) e 9510 (CEMPRE por seção, classificação 12762).
- **PNCP:** `pncp.gov.br/api/consulta/v1/contratacoes/proposta` e `/v1/contratacoes/publicacao` (paginados; o
  Prospecta pede 50 por página).
- **Comex Stat:** `api-comexstat.mdic.gov.br/general/dates/updated` e `POST /cities` (filtro `city` com o código IBGE).
- **Portal da Transparência:** `api.portaldatransparencia.gov.br/api-de-dados/ceis`, `/cnep` e `/contratos/cpf-cnpj`
  (cabeçalho `chave-api-dados`). Só a documentação (swagger v3) foi conferida, porque a API exige token.
- **PageSpeed:** `www.googleapis.com/pagespeedonline/v5/runPagespeed`. Sem chave, a cota anônima devolveu 429 no teste
  real.

## Instagram (API oficial)

Lê perfis do Instagram pela **Graph API da Meta (Business Discovery)**, sem raspar o site do Instagram. Código em
`api/src/modules/social/`.

- **Endpoint** (documentação conferida em 06/11/2026): `GET graph.facebook.com/{versão}/{ID da conta comercial de quem consulta}?fields=business_discovery.username({@}){username,biography,website,followers_count,media_count}`.
  Versão em `META_GRAPH_VERSION` (padrão `v27.0`). Só campos marcados como públicos na referência do IG User.
- **O que precisa** (por conta, em Configurações › Integrações):
  - uma conta comercial ou de criador no Instagram, ligada a uma Página do Facebook;
  - um app na Meta e um token de usuário com `instagram_basic` e `pages_read_engagement` (a página do Business Discovery
    também cita `instagram_manage_insights`);
  - o ID dessa conta comercial (campo `instagram_business_account` da Página).
  Ao salvar, o Prospecta confere o token na Meta (`GET /{ID}?fields=username`); token e ID ficam cifrados e nunca voltam ao navegador.
- **Quem aparece:** só perfis comerciais ou de criador. Perfil pessoal, privado ou com restrição de idade devolve "não encontrado".
  O código de erro para esse caso não está na documentação; o Prospecta trata os casos 110, 2207013 e "cannot be found".
- **De onde vem o @:** link do Instagram no site oficial (já coletado), site cadastrado que é o próprio Instagram (comum no
  Google Maps; agora vira também perfil social) ou o @ informado na ficha.
- **O que é gravado:**
  - no perfil social: bio, site, seguidores, posts e a data da leitura (`social_profiles.details`);
  - em Contatos, com origem `INSTAGRAM` ("Instagram (bio)"): WhatsApp só com link wa.me ou celular junto de "whats", "zap"
    ou "wpp"; o resto fica como telefone;
  - o site da bio vira o site da empresa quando ela não tinha site próprio (agregador como linktr.ee não conta).
    O próximo "Enriquecer" analisa esse site.
  - Número já existente por outra fonte passa a confirmado. Nada existente é sobrescrito. Contato na lista de bloqueio não volta.
- **Vínculo:** o perfil fica "Vínculo confirmado" quando o site ou um telefone da bio batem com os da empresa.
- **Quando roda:** botão na ficha (Visão geral › Instagram) e dentro do "Enriquecer", quando a integração está ligada e há um @
  conhecido. Sem site próprio, o "Enriquecer" lê o Instagram e, se a bio trouxer um site, já o analisa no mesmo processo.
- **Limites:** a Meta limita por app (200 chamadas por hora por usuário do app) e não publica o limite por token. O Prospecta
  se limita a 3 consultas por minuto e a 150 por dia por conta, e reaproveita a leitura por 30 dias (configurável). Erros 4,
  17, 32, 341, 613 e 80002 viram "limite atingido" e não são repetidos.
- **Testes:** `test/unit/instagram.test.ts` e `test/integration/instagram.test.ts`, com a Graph API simulada (sem rede).

## Central de integrações

Em **Configurações › Integrações** cada fonte mostra estado (ativa, desativada ou pendente de chave ou base),
documentação, última execução, última com sucesso, execuções e falhas em 30 dias, erros recentes, uso do dia e
limites. Dá para ligar e desligar, ajustar consultas por dia, cache em dias e concorrência, agendar a sincronização
diária do radar (6h) e cadastrar ou remover a chave gratuita. O botão **Testar** faz uma consulta pública barata, ou
simulada no modo de teste.

API:

| Rota | O que faz |
|---|---|
| `GET /integrations` | Fontes, configuração e uso |
| `PUT /integrations/:id` | Muda a configuração |
| `PUT/DELETE /integrations/:id/credential` | Cadastra ou remove a chave |
| `POST /integrations/:id/test` | Teste rápido da fonte |

## Ficha da empresa

- **Inteligência comercial:**
  - *Cadastro oficial (Receita, dados abertos)*, com confirmação de candidatos;
  - *Aderência por oferta*;
  - *Registros públicos*;
  - *Demonstrações financeiras (CVM)*, só quando o CNPJ é de companhia aberta.
- **Indicadores regionais** (aba nova): IBGE, Comex Stat e CAGED do município, sempre rotulados como dado do município.
  O setor da empresa (seção CNAE) fica destacado.
- **Auditoria:** diagnóstico técnico complementar, que não entra nas notas. Mostra:
  - certificado TLS e redirecionamento HTTP→HTTPS;
  - URL canônica;
  - tecnologias detectadas (CMS, loja, frameworks, análise, pixels, atendimento, marketing, conversão);
  - PageSpeed celular e computador, com dados reais;
  - achados comprovados, cada um com gravidade, fonte e "por que pode ser oportunidade". O texto nunca afirma que a
    empresa precisa contratar algo.

  Quando o Chromium não está disponível, o laboratório do PageSpeed (celular) ocupa o lugar do Lighthouse local.

As notas e a metodologia da auditoria (2026.10-1) não mudaram. Na inteligência comercial, o cadastro oficial da base
local passa a contar como perfil empresarial quando não há Econodata (critério "CNPJ ativo").

## Radar público (PNCP)

Menu **Radar público**. A sincronização busca as contratações com proposta aberta nos próximos 60 dias e as publicações
recentes das modalidades escolhidas, nas UFs ou municípios configurados. A classificação usa os segmentos da conta,
com palavras-chave procuradas no objeto (sem acento, palavra inteira). Os segmentos vêm prontos e são editáveis:

- marketing;
- software;
- sites;
- equipamentos;
- manutenção;
- serviços empresariais.

O órgão público é o comprador, não um lead. Rotas: `GET /radar`, `POST /radar/sync` (fila `public-data`) e
`GET/PUT /radar/settings`.

## Score por oferta

Em **Configurações › Ofertas** cada produto ou serviço pode ter segmentos, portes e pesos próprios. Há modelos prontos:
Desenvolvimento de sites, Gestão de atendimento e Sistema de alto custo. As mesmas evidências da empresa são pontuadas
com esses pesos (`GET /companies/:id/offers`). A prioridade A/B/C da conta não muda.

Dois critérios opcionais só existem quando a configuração dá peso a eles. Sem esse peso, as notas atuais ficam iguais:

- `opp.site_gaps`: falhas técnicas comprovadas na última auditoria;
- `opp.no_website`: sem site próprio, com presença só em ficha ou redes.

## Importação de arquivos oficiais

Nada é baixado automaticamente. Baixe os arquivos, extraia os `.zip` ou `.7z` e importe pela linha de comando, que lê
em streaming (memória constante), grava em lotes e guarda o checkpoint na mesma transação de cada lote. **Ctrl+C**
interrompe com segurança: rodar de novo continua da última linha gravada.

```bash
cd platform/api
npm run cli:dados-publicos -- receita --tipo estabelecimentos --arquivo K3241.K03200Y0.D51108.ESTABELE --uf PR
npm run cli:dados-publicos -- receita --tipo empresas --arquivo K3241.K03200Y0.D51108.EMPRECSV
npm run cli:dados-publicos -- receita --tipo municipios --arquivo F.K03200$Z.D51108.MUNICCSV
npm run cli:dados-publicos -- caged --arquivo CAGEDMOV202509.txt --uf PR
npm run cli:dados-publicos -- cvm --tipo cadastro --arquivo cad_cia_aberta.csv
npm run cli:dados-publicos -- cvm --tipo dfp --arquivo dfp_cia_aberta_DRE_con_2025.csv
npm run cli:dados-publicos -- status
```

No Docker, o mesmo comando roda com `node dist/cli/importar-dados-publicos.js …` dentro do contêiner da API. Caminhos
relativos são lidos de `PUBLIC_DATA_DIR` (padrão `./dados-publicos`).

### Receita Federal

Fonte: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos>. Os arquivos mensais ficam numa
pasta compartilhada que exige navegador. São CSV sem cabeçalho, com `;`, aspas e Latin-1.

**Ordem de importação:**

1. códigos: `cnaes`, `naturezas`, `municipios`, `motivos`;
2. `estabelecimentos`, sempre com `--uf` e, se quiser, `--municipio` (código da Receita);
3. `empresas` e `socios`: só entram as raízes que já estão no recorte.

A base nacional inteira não é importada. Para o país todo, conte com dezenas de GB em disco e algumas horas.

**Minimização (LGPD):**

- de Sócios fica só a quantidade, sem nomes nem CPF;
- de Estabelecimentos o e-mail vira só o domínio, e domínios de provedores gratuitos (gmail, hotmail, uol…) são
  descartados.

Para refazer Sócios: `--limpar-socios` e importe todos os arquivos de novo.

### Novo CAGED

Microdados divulgados pelo MTE (página da fonte na tabela acima). O endereço de download não foi conferido daqui, porque é FTP. Os arquivos são `CAGEDMOV<AAAAMM>.7z`.
Extraia o `.txt`. A importação lê competência, município, seção e saldo, soma por competência × município × seção e
descarta todo o resto, sem nenhum dado de trabalhador. `CAGEDFOR` e `CAGEDEXC` (fora do prazo e exclusões) ainda não
são aplicados, então o saldo pode diferir um pouco do divulgado. Use `--codificacao latin1` se o arquivo não for UTF-8.

### CVM

- **Cadastro:** <https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv> (cerca de 1,5 MB).
- **DFP:** `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_<ano>.zip` (cerca de 13 MB por ano).
  Extraia e importe `dfp_cia_aberta_BPA|BPP|DRE_con|ind_<ano>.csv`.

Ficam só o último exercício e as contas principais:

- ativo total;
- passivo circulante e não circulante;
- patrimônio líquido;
- receita;
- lucro ou prejuízo.

## Credenciais gratuitas

- **Portal da Transparência:** cadastro de e-mail em <https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email>
  (gov.br).
- **PageSpeed Insights:** chave de API do Google Cloud. Veja
  <https://developers.google.com/speed/docs/insights/v5/get-started#APIKey>.
- **Instagram:** token de usuário de um app da Meta e o ID da conta comercial. Veja a seção Instagram acima e
  <https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery>.

## Testes

- `test/unit/public-data.test.ts`:
  - parsers e convenções do IBGE, resumo do Comex, classificação e datas do PNCP;
  - datas e situação das sanções;
  - tecnologias, PageSpeed, SSRF, TLS e diagnóstico;
  - CSV, colunas do CAGED, minimização da Receita;
  - nova tentativa, critérios opcionais e ofertas.
- `test/integration/public-data.test.ts`: os 25 cenários da especificação com as fontes simuladas, incluindo
  importação interrompida e retomada, SSRF, chave que nunca volta ao navegador e a prova de que não há chamada de rede.

## Pendências conhecidas

- **Validação real:**
  - Portal da Transparência e PageSpeed precisam das chaves gratuitas;
  - importações da Receita, do CAGED e da CVM precisam dos arquivos oficiais. Foram validadas com amostras sintéticas.
- **CAGED:** aplicar `CAGEDFOR` e `CAGEDEXC`.
- **Ainda não feito:**
  - filtros avançados da lista de empresas pelos indicadores novos;
  - painel de execuções no dashboard.
