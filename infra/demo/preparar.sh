#!/usr/bin/env bash
# Prepara la demo: genera infra/demo/.env con claves aleatorias (fuera de git, permisos 600).
# Alternativa manual: cp infra/demo/.env.example infra/demo/.env y llenarlo.
# Uso: infra/demo/preparar.sh demo.suempresa.pe [puerto]
# No sobrescribe un .env existente: las claves de PostgreSQL quedan fijadas en su volumen.
set -euo pipefail
cd "$(dirname "$0")"

DOMINIO="${1:-}"
PUERTO="${2:-8080}"
if [[ -z "$DOMINIO" || "$DOMINIO" == *"://"* || "$DOMINIO" == *"/"* ]]; then
  echo "Uso: $0 <dominio sin https://> [puerto]   Ej.: $0 demo.suempresa.pe 8080" >&2
  exit 1
fi
if [[ -f .env ]]; then
  echo "infra/demo/.env ya existe; no se modifica. Bórrelo solo si también borra los volúmenes." >&2
  exit 0
fi

clave() { openssl rand -hex 24; }
umask 077
cat > .env <<ENV
DOMINIO=${DOMINIO}
PUERTO_WEB=${PUERTO}
DB_HOST=postgres
DB_PORT=5432
DB_NAME=campo
POSTGRES_PASSWORD=$(clave)
APP_MIGRATOR_PASSWORD=$(clave)
APP_RW_PASSWORD=$(clave)
WORKER_RW_PASSWORD=$(clave)
APP_RO_PASSWORD=$(clave)
S3_ACCESS_KEY_APP=campo-demo
S3_SECRET_KEY_APP=$(clave)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
TUSD_HOOK_SECRET=$(clave)
ENV
mkdir -p mapa
echo "Listo: infra/demo/.env para https://${DOMINIO} (puerto interno ${PUERTO})."
