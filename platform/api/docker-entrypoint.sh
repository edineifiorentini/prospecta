#!/bin/sh
set -e
# A API aplica as migrations versionadas antes de subir; o worker só inicia depois da API saudável.
if [ "${ROLE:-api}" = "api" ]; then
  npx prisma migrate deploy
fi
exec "$@"
