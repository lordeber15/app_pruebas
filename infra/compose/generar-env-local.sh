#!/usr/bin/env bash
# Prepara el entorno local con claves aleatorias. No sobrescribe archivos existentes.
#  - infra/compose/.env: claves de los contenedores (las de PostgreSQL quedan fijadas en el volumen).
#  - .env (raíz del monorepo): conexiones para api, worker, migraciones y codegen.
# Ambos están ignorados por git.
set -euo pipefail
cd "$(dirname "$0")"

clave() { openssl rand -hex 24; }
umask 077

if [[ -f .env ]]; then
  echo "infra/compose/.env ya existe; no se modifica."
else
  cat > .env <<ENV
POSTGRES_PASSWORD=$(clave)
APP_MIGRATOR_PASSWORD=$(clave)
APP_RW_PASSWORD=$(clave)
WORKER_RW_PASSWORD=$(clave)
APP_RO_PASSWORD=$(clave)
CAMPO_PG_PORT=5432
CAMPO_API_PORT=3000
S3_ACCESS_KEY_APP=campo-local
S3_SECRET_KEY_APP=$(clave)
TUSD_HOOK_SECRET=$(clave)
ENV
  echo "Creado infra/compose/.env"
fi

# shellcheck disable=SC1091
source .env
RAIZ=../../.env
if [[ -f "$RAIZ" ]]; then
  echo ".env de la raíz ya existe; no se modifica."
else
  cat > "$RAIZ" <<ENV
NODE_ENV=development
TZ=UTC
PORT=${CAMPO_API_PORT}
DATABASE_URL=postgres://app_rw:${APP_RW_PASSWORD}@127.0.0.1:${CAMPO_PG_PORT}/campo
DATABASE_URL_WORKER=postgres://worker_rw:${WORKER_RW_PASSWORD}@127.0.0.1:${CAMPO_PG_PORT}/campo
DATABASE_URL_MIGRATIONS=postgres://app_migrator:${APP_MIGRATOR_PASSWORD}@127.0.0.1:${CAMPO_PG_PORT}/campo
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=http://localhost:${CAMPO_API_PORT}
WEB_ORIGIN=http://localhost:5173
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET_ARCHIVOS=archivos
S3_ACCESS_KEY_APP=${S3_ACCESS_KEY_APP}
S3_SECRET_KEY_APP=${S3_SECRET_KEY_APP}
S3_PRESIGN_TTL_SECONDS=900
TUSD_HOOK_SECRET=${TUSD_HOOK_SECRET}
ENV
  echo "Creado .env en la raíz"
fi
