#!/bin/sh
# Levanta MinIO + tusd en el puerto 1080. Con "limpiar" borra antes los datos de la prueba anterior.
set -e
cd "$(dirname "$0")/../servidor"
if [ ! -f .env ]; then
  printf 'POC_S3_USUARIO=poc%s\nPOC_S3_CLAVE=%s\n' "$(openssl rand -hex 4)" "$(openssl rand -hex 24)" > .env
fi
[ "$1" = "limpiar" ] && docker compose down -v
docker compose up -d
