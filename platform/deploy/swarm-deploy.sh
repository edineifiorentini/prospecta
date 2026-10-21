#!/bin/sh
# Implanta ou atualiza a stack "prospecta" no Docker Swarm com as variáveis do .env da raiz.
# Uso, na pasta do projeto no servidor:  sh platform/deploy/swarm-deploy.sh
set -eu
cd "$(dirname "$0")/../.."
[ -f .env ] || { echo "Crie o .env antes (platform/docs/DEPLOY-VPS.md)." >&2; exit 1; }

# carrega o .env sem interpretar o conteúdo: há valores com espaços, < > e dois-pontos
while IFS= read -r line || [ -n "$line" ]; do
  line=$(printf '%s' "$line" | tr -d '\r')
  case "$line" in '' | '#'*) continue ;; esac
  case "$line" in *=*) export "${line%%=*}=${line#*=}" ;; esac
done < .env

# as imagens prospecta/*:local são compiladas no próprio servidor (sem registro)
docker stack deploy --detach=true --resolve-image=never -c platform/deploy/prospecta-stack.yaml prospecta
