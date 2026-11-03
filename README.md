# Plataforma de campo: pruebas en iPhone

Este repositorio contiene, por ahora, solo pruebas desechables (PoC) de la Fase 0. No es la app final. Las pruebas comprueban en celulares reales lo más riesgoso: avisos por cercanía, GPS en segundo plano, subida de fotos con cortes y velocidad del hash.

El estado de cada prueba está en [`poc/ACTA.md`](poc/ACTA.md). En Android ya se probaron; faltan los resultados en iPhone.

## Qué hay que probar en iPhone

| Prueba | App (carpeta) | Tiempo | Necesita la Mac durante la prueba |
|---|---|---|---|
| PoC-06 Hash | `poc/poc-05-06-subida` | 2 min | No |
| PoC-05 Subida con cortes | `poc/poc-05-06-subida` | 30 min | Sí: servidor con Docker y la misma WiFi |
| PoC-02 Aviso de cercanía | `poc/poc-02-cercania` | ~1 h a pie | No |
| PoC-03 Transecto | `poc/poc-03-04-transecto` | 1–2 h a pie | No |

Cada app tiene un botón **"Ver indicaciones"** con los pasos exactos para iPhone. Este documento explica cómo instalarlas.

## Requisitos

- Una Mac con Xcode, Node 22 o superior, pnpm (`npm install -g pnpm`) y CocoaPods (`brew install cocoapods`).
- Un iPhone conectado por cable y una cuenta de Apple. Sirve una gratuita, pero las apps caducan a los 7 días y hay que volver a instalarlas.
- Solo para PoC-05: Docker Desktop abierto.

## Preparar el iPhone (una sola vez)

1. Conéctelo por cable y toque **Confiar** en el iPhone.
2. Active **Ajustes > Privacidad y seguridad > Modo de desarrollador** y reinicie el iPhone cuando lo pida.
3. En Xcode, agregue su cuenta de Apple en **Xcode > Settings > Accounts**.

## Instalar cada app

Repita esto en cada una de las tres carpetas de la tabla:

```
cd poc/poc-05-06-subida
pnpm install
pnpm expo run:ios --device --configuration Release
```

Elija su iPhone en la lista. Si pide un equipo de firma, elija su cuenta.

Use siempre **Release**. En Debug, la app depende de que la Mac le envíe el código y deja de funcionar al alejarse, así que no sirve para caminar.

La primera vez que abra la app, iOS puede bloquearla por ser de un desarrollador no verificado. Autorícela en **Ajustes > General > VPN y gestión de dispositivos**, tocando su cuenta y luego **Confiar**.

### Si falla la firma

- **El identificador ya está en uso:** el identificador `pe.genia.poc...` puede estar tomado por otra cuenta. En el `app.json` de esa carpeta, agregue sus iniciales al final de `ios.bundleIdentifier`, por ejemplo `pe.genia.poc.subida.jp`. Luego borre la carpeta `ios` y repita el comando.
- **Con Xcode:** corra `pnpm expo prebuild --platform ios` y abra el archivo `.xcworkspace` de la carpeta `ios`. En **Signing & Capabilities** elija su cuenta. En **Product > Scheme > Edit Scheme > Run**, cambie **Build Configuration** a **Release** y toque Run.

## Servidor para PoC-05

En la carpeta `poc/poc-05-06-subida`:

```
scripts/servidor.sh limpiar     # levanta el servidor; borra los datos de la prueba anterior
ipconfig getifaddr en0          # IP de la Mac para escribir en la app: http://<IP>:1080
scripts/verificar.sh 50         # al terminar la subida, comprueba los 50 archivos
```

La primera vez, `scripts/servidor.sh` genera claves locales en `servidor/.env`. Ese archivo no se sube al repositorio.

## Qué enviar al terminar

Por cada prueba, envíe la captura del resultado junto con el modelo del iPhone y su versión de iOS. En PoC-05, envíe además la salida de `scripts/verificar.sh 50`. Si algo no funciona, envíe una captura del error.

Las apps no envían nada a internet. Las pruebas de cercanía y transecto guardan posiciones solo en el iPhone, así que úselas solo con la persona que hace la prueba.
