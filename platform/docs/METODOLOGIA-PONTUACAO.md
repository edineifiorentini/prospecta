# Metodologia de pontuação — versão 2026.10-1

Implementação: `platform/api/src/modules/audit/scoring.ts` (critérios e cálculo),
`evaluate.ts` (avaliação por evidências) e `report.ts` (relatório).

## Princípios

1. **Só evidência conta.** Cada critério registra resultado, detalhe, URL de origem e data da observação.
2. **Ausência de dado ≠ falha.** Quando uma informação não pôde ser consultada (ex.: empresa não veio do
   Google Maps, site bloqueado por robots.txt, Lighthouse indisponível), o critério é **Não avaliado** e
   sai do numerador **e** do denominador.
3. **Confiança explícita.** Cada indicador informa a fração do peso total que foi efetivamente avaliada.
4. **Nada é oficial.** Os indicadores são estimativas internas sobre dados públicos acessíveis. Não são
   auditorias do Google, não atestam verificação/gestão do Perfil da Empresa e não estimam seguidores ou
   engajamento. Registro MX não garante entrega de e-mail.

## Cálculo

| Resultado | Crédito |
|---|---|
| Atende (PASS) | 100% do peso |
| Parcial (WARN) | 50% do peso |
| Não atende (FAIL) | 0% |
| Não avaliado / Info | fora do cálculo |

```
pontuação  = round(100 × Σ(peso × crédito) / Σ(peso dos critérios avaliados))
confiança  = Σ(peso avaliado) / Σ(peso total da dimensão)
se confiança < 30% → "Não avaliado"
```

Os pesos padrão abaixo podem ser alterados por organização em **Configurações → Pontuação**
(`organizations.settings.scoring[dimensão][critério]`). A mudança vale para as próximas auditorias.

## Indicadores e critérios (peso padrão)

### 1. Qualidade e completude dos dados do lead (`DATA_QUALITY`)
Calculado após cada importação e enriquecimento (sem acesso à rede) e recalculado na auditoria.

| Critério | Peso | Atende | Parcial | Não atende |
|---|---|---|---|---|
| Nome comercial | 5 | sempre | — | — |
| Categoria | 5 | informada | — | ausente |
| Endereço | 10 | informado | — | ausente |
| Cidade | 5 | informada pela fonte | estimada pela área pesquisada | desconhecida |
| Telefone válido (E.164) | 15 | ≥ 1 válido | — | nenhum |
| Telefone confirmado | 5 | em 2 fontes ou no site oficial | 1 fonte | — |
| E-mail comercial | 15 | ≥ 1 não inválido | — | nenhum |
| MX do e-mail | 5 | MX encontrado | — | domínio sem MX |
| Site | 10 | acessível | informado, não verificado | ausente |
| Rede social confirmada | 10 | vínculo confirmado | encontrada sem confirmação | não encontrada nas fontes consultadas |
| CNPJ | 5 | identificado | não publicado no site | — |
| Atualização | 10 | verificado ≤ 90 dias | ≤ 180 dias | > 180 dias |

### 2. Presença pública no Google (`GOOGLE_PRESENCE`)
Somente quando há dados públicos do Google Maps para a empresa; caso contrário, **todos os critérios ficam
Não avaliado** (nunca zero).

| Critério | Peso | Regra |
|---|---|---|
| Ficha encontrada | 10 | ficha pública localizada |
| Categoria | 10 | visível na ficha |
| Endereço | 10 | visível |
| Telefone | 15 | visível |
| Site vinculado | 15 | visível |
| Horário | 10 | publicado |
| Volume de avaliações | 15 | ≥ 50 atende · 10–49 parcial · < 10 não atende |
| Nota | 10 | ≥ 4,5 atende · 4,0–4,49 parcial · < 4,0 não atende |
| Descrição | 5 | presente |
| Fotos | 5 | ≥ 5 visíveis na coleta · 1–4 parcial · 0 não atende |

### 3. Qualidade técnica do website (`WEBSITE_QUALITY`)
Visita do site respeitando robots.txt (Crawlee + Cheerio, fallback Playwright), Lighthouse local (perfil
celular) e verificação de até 15 links internos permitidos pelo robots.txt.

| Critério | Peso | Regra |
|---|---|---|
| Site no ar | 15 | HTTP 2xx/3xx |
| HTTPS | 10 | HTTPS e HTTP→HTTPS · parcial se não redireciona · falha sem HTTPS |
| Celular (viewport) | 8 | meta viewport |
| Velocidade | 12 | Lighthouse ≥ 90 · 50–89 parcial · < 50 · sem Lighthouse: resposta < 800 ms / < 2 s |
| Título | 5 | 10–70 caracteres |
| Meta description | 5 | 50–170 caracteres |
| H1 | 5 | exatamente um |
| H2 | 3 | ao menos um |
| Links internos | 6 | nenhum quebrado · ≤ 2 parcial · > 2 |
| Página de contato | 6 | visitada · link existente mas não analisada (parcial) |
| Botões de contato | 6 | tel:, mailto:, WhatsApp ou formulário |
| Chamada para ação | 4 | CTA comercial identificada |
| SEO (Lighthouse) | 4 | ≥ 90 · 70–89 parcial · < 70 |
| Open Graph | 3 | og:title + og:image/description |
| Sitemap | 3 | XML válido |
| robots.txt | 3 | presente (ausência = parcial) |
| Schema.org | 5 | Organization/LocalBusiness em JSON-LD |
| Links para redes | 4 | o site aponta para perfis |
| Acessibilidade | 4 | Lighthouse ≥ 90 · ou ≤ 10% de imagens sem alt |
| Idioma | 2 | atributo lang |

### 4. Presença digital multicanal (`MULTICHANNEL`)
Perfis só contam com evidência (link no site oficial, etiqueta OSM ou ficha pública). “Não encontrado nas
fontes consultadas” só é falha quando as fontes foram de fato consultadas.

| Critério | Peso |
|---|---|
| Site próprio ativo | 20 |
| Ficha no Google Maps (não avaliado se o Google não foi consultado) | 10 |
| Instagram | 15 |
| Facebook | 10 |
| LinkedIn | 8 |
| YouTube ou TikTok | 5 |
| WhatsApp divulgado pela empresa | 15 |
| E-mail comercial | 12 |
| Coerência marca/domínio/perfis | 5 |

### 5. Oportunidade comercial (`OPPORTUNITY`)
Aqui **atende = oportunidade identificada com evidência**.

| Critério | Peso |
|---|---|
| Sem site próprio ou site fora do ar | 25 |
| Sem HTTPS forçado | 10 |
| Site lento | 10 |
| ≥ 2 falhas de SEO básico | 10 |
| Sem Instagram nem Facebook vinculados | 10 |
| Poucas avaliações ou nota baixa | 10 |
| Ficha do Google incompleta | 10 |
| Canal de contato comercial disponível | 15 |

## Relatório
Resumo executivo, pontos positivos, problemas (somente com evidência), recomendações priorizadas
(P1–P3, impacto potencial), serviços sugeridos, evidências por critério com links e datas, grau de
confiança e aviso de que se trata de estimativa interna. Exportável em PDF (Chromium local, sem acesso
externo durante a renderização).
