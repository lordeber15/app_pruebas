#!/usr/bin/env bash
# PoC-01: genera el paquete cartografico (PMTiles + GeoJSON + glifos) desde un KMZ o KML.
# Uso: [CAMPOS=a,b,c] scripts/generar-datos.sh <archivo.kmz|kml> [bbox] [maxzoom] [build_protomaps]
# CAMPOS limita los atributos que se conservan; sin ella se conservan todos.
set -euo pipefail

ORIGEN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
BBOX="${2:--81.0,-18.4,-70.0,-3.4}"
MAXZOOM="${3:-13}"
BUILD="${4:-20261030.pmtiles}"

GDAL_IMAGE=ghcr.io/osgeo/gdal:alpine-normal-latest
PMTILES_IMAGE=protomaps/go-pmtiles
FONTS_URL=https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SALIDA="$RAIZ/assets/mapa"
mkdir -p "$SALIDA/glifos"

NOMBRE="$(basename "$ORIGEN")"
case "$NOMBRE" in
  *.kmz | *.KMZ) ENTRADA="/vsizip//in/$NOMBRE/doc.kml" ;;
  *) ENTRADA="/in/$NOMBRE" ;;
esac

# El controlador GeoJSON no reemplaza un archivo cuya capa tiene otro nombre.
rm -f "$SALIDA/capa-kmz.geojson"
docker run --rm -v "$(dirname "$ORIGEN"):/in:ro" -v "$SALIDA:/out" "$GDAL_IMAGE" \
  ogr2ogr -f GeoJSON -lco RFC7946=YES -lco COORDINATE_PRECISION=6 \
    ${CAMPOS:+-select "$CAMPOS"} \
    -makevalid -dim XY /out/capa-kmz.geojson "$ENTRADA"

docker run --rm -v "$SALIDA:/out" "$PMTILES_IMAGE" extract \
  "https://build.protomaps.com/$BUILD" /out/base.pmtiles \
  --bbox="$BBOX" --maxzoom="$MAXZOOM"

for rango in 0-255 256-511 8192-8447; do
  curl -fsS -o "$SALIDA/glifos/$rango.pbf" "$FONTS_URL/Noto%20Sans%20Regular/$rango.pbf"
done

# La app toma de aqui el encuadre y distingue un paquete de otro.
printf '{ "id": "%s", "bbox": [%s], "maxzoom": %s }\n' \
  "$(printf '%s' "${NOMBRE%.*}-$BBOX-$MAXZOOM" | shasum | cut -c1-12)" "$BBOX" "$MAXZOOM" \
  > "$RAIZ/src/area.json"

ls -la "$SALIDA" "$SALIDA/glifos"
