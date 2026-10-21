#!/bin/sh
# Substitui o banco da stack "prospecta" por um backup (.dump de backup.mjs ou swarm-backup.sh).
# Para a API e o worker durante a restauração e sobe os dois de novo no final.
# Uso:  sh platform/deploy/swarm-restore.sh platform/backups/prospecta-AAAAMMDD-HHMMSS.dump --yes
set -eu
cd "$(dirname "$0")/../.."
dump=${1:-}
[ -f "$dump" ] || { echo "Informe o arquivo .dump." >&2; exit 1; }
[ "${2:-}" = "--yes" ] || { echo "Isso apaga os dados atuais do banco do Prospecta. Repita com --yes para confirmar." >&2; exit 1; }

sha="${dump%.dump}.sha256"
if [ -f "$sha" ]; then
  (cd "$(dirname "$dump")" && sha256sum -c "$(basename "$sha")" >/dev/null) || { echo "SHA-256 não confere: arquivo alterado ou corrompido." >&2; exit 1; }
  echo "SHA-256 confere"
fi

cid=$(docker ps -q -f name=prospecta_postgres -f status=running | head -n 1)
[ -n "$cid" ] || { echo "O banco da stack prospecta não está rodando." >&2; exit 1; }

docker service scale --detach=false prospecta_platform-worker=0 prospecta_platform-api=0
docker exec -i "$cid" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error' < "$dump"
docker service scale --detach=false prospecta_platform-api=1 prospecta_platform-worker=1
echo "restauração concluída: $dump"
