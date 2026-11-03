#!/bin/sh
# Descarga lo que quedo en S3 y recalcula cada SHA-256 contra el enviado en los metadatos tus.
# Uso: scripts/verificar.sh [cantidad-esperada]
set -e
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
ESPERADOS="${1:-50}"
. "$RAIZ/servidor/.env"
RED="$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(cd "$RAIZ/servidor" && docker compose ps -q minio)")"
DESTINO="$(mktemp -d)"
trap 'rm -rf "$DESTINO"' EXIT
docker run --rm --network "$RED" -v "$DESTINO:/d" \
  -e AWS_ACCESS_KEY_ID="$POC_S3_USUARIO" -e AWS_SECRET_ACCESS_KEY="$POC_S3_CLAVE" -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli --endpoint-url http://minio:9000 s3 sync --only-show-errors s3://archivos /d
node "$RAIZ/scripts/comparar.mjs" "$DESTINO" "$ESPERADOS"
