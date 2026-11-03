#!/bin/bash
# PoC-05 en emulador Android: sube con la red limitada y corta de cuatro maneras, por turnos,
# hasta que la app indica "terminada". Requiere la app abierta, un lote recien generado
# y el servidor http://10.0.2.2:1081 (el proxy de 1 MB/s que levanta este script).
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$RAIZ/servidor/docker-compose.yml")
INTERVALO_S="${1:-25}"
LIMITE_BPS="${2:-1000000}"

vista() { adb shell uiautomator dump /sdcard/v.xml >/dev/null 2>&1; adb exec-out cat /sdcard/v.xml; }
textos() { vista | grep -o 'text="[^"]*"' | sed 's/text="//;s/"$//' | grep -v '^$'; }
toque() {
  local b
  b=$(vista | perl -pe 's#><#>\n<#g' | grep -F "text=\"$1\"" | head -1 | grep -o 'bounds="[^"]*"' | grep -oE '[0-9]+' | tr '\n' ' ')
  [ -z "$b" ] && return 1
  set -- $b
  adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
anotar() { echo "$(date +%T) $*"; }
estado() { textos | grep -E 'Subidas:|Reintentos:' | tr '\n' ' '; echo; }
iniciar() { toque "Continuar subida" || toque "Subir"; }

node "$RAIZ/scripts/limitar.mjs" 1081 1080 "$LIMITE_BPS" &
PROXY=$!
trap 'kill $PROXY' EXIT
sleep 1
iniciar
anotar "inicio: $(estado)"
vuelta=0
while ! textos | grep -q "terminada"; do
  sleep "$INTERVALO_S"
  textos | grep -q "terminada" && break
  case $((vuelta % 4)) in
    0)
      anotar "corte: modo avion 20 s"
      adb shell cmd connectivity airplane-mode enable
      sleep 20
      adb shell cmd connectivity airplane-mode disable
      ;;
    1)
      anotar "corte: tusd cae (kill) 15 s"
      "${COMPOSE[@]}" kill tusd >/dev/null 2>&1
      sleep 15
      docker start "$("${COMPOSE[@]}" ps -aq tusd)" >/dev/null
      ;;
    2)
      anotar "corte: tusd congelado 45 s (red muda)"
      "${COMPOSE[@]}" pause tusd >/dev/null 2>&1
      sleep 45
      "${COMPOSE[@]}" unpause tusd >/dev/null 2>&1
      ;;
    3)
      anotar "corte: app cerrada a la fuerza"
      adb shell am force-stop pe.genia.poc.subida
      sleep 3
      adb shell am start -n pe.genia.poc.subida/.MainActivity >/dev/null
      sleep 5
      iniciar
      ;;
  esac
  vuelta=$((vuelta + 1))
  anotar "$(estado)"
done
anotar "fin tras $vuelta cortes: $(estado)"
