# Site de demonstração (fictício)

Usado somente para testar o enriquecimento sem acessar empresas reais. Domínios `.example` e
números inexistentes. Sobe com `docker compose --profile demo up -d demo-site` e só é acessível
pelo crawler porque `CRAWLER_ALLOW_HOSTS=demo.prospecta.test` o libera explicitamente (padrão: vazio).
