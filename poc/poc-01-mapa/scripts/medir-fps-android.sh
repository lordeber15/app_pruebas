#!/usr/bin/env bash
# PoC-01: mide los FPS reales del mapa desde SurfaceFlinger, segundo a segundo.
# Conecte el celular por USB, abra la app y toque "Recorrido de prueba" justo al iniciar.
set -euo pipefail

SEGUNDOS="${1:-34}"
capa="$(adb shell dumpsys SurfaceFlinger --list \
  | grep -o '[0-9a-f]* SurfaceView\[pe.genia.poc.mapa[^]]*\](BLAST)#[0-9]*' | head -1)"
[ -n "$capa" ] || { echo "No se encontro el mapa en pantalla" >&2; exit 1; }

for _ in $(seq "$SEGUNDOS"); do
  adb shell "dumpsys SurfaceFlinger --latency '$capa'"
  sleep 1
done | python3 -I -c '
import sys

marcas = set()
for linea in sys.stdin:
    partes = linea.split()
    if len(partes) == 3 and 0 < int(partes[1]) < 10**17:
        marcas.add(int(partes[1]))
marcas = sorted(marcas)
por_segundo = {}
for marca in marcas:
    segundo = (marca - marcas[0]) // 10**9
    por_segundo[segundo] = por_segundo.get(segundo, 0) + 1
activos = [n for s, n in sorted(por_segundo.items())][1:-1]
activos = [n for n in activos if n >= 5]
print("segundos con movimiento:", len(activos))
print("promedio:", round(sum(activos) / len(activos), 1))
print("minimo:", min(activos))
print("segundos con 30 FPS o mas:", sum(n >= 30 for n in activos), "de", len(activos))
'
