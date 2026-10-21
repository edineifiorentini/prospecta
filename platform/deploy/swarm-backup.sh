#!/bin/sh
# Backup do banco da stack "prospecta" (pg_dump em formato custom) em platform/backups/.
# Uso:  sh platform/deploy/swarm-backup.sh [quantidade a manter, padrão 14]
# Os arquivos contêm dados pessoais (telefones, e-mails): ficam só para o root (chmod 600).
set -eu
cd "$(dirname "$0")/../.."
keep=${1:-14}
mkdir -p platform/backups
chmod 700 platform/backups

cid=$(docker ps -q -f name=prospecta_postgres -f status=running | head -n 1)
[ -n "$cid" ] || { echo "O banco da stack prospecta não está rodando." >&2; exit 1; }

file="platform/backups/prospecta-$(date +%Y%m%d-%H%M%S).dump"
docker exec "$cid" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$file.tmp"
mv "$file.tmp" "$file"
(cd platform/backups && sha256sum "$(basename "$file")" > "$(basename "${file%.dump}").sha256")
chmod 600 "$file" "${file%.dump}.sha256"

# mantém só os mais recentes
ls -1t platform/backups/prospecta-*.dump | tail -n +$((keep + 1)) | while read -r old; do
  rm -f "$old" "${old%.dump}.sha256" "${old%.dump}.json"
done
echo "backup ok: $file ($(du -h "$file" | cut -f1))"
