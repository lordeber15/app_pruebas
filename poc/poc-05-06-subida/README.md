# PoC-05 y PoC-06: subida reanudable y hash

Pruebas desechables del plan de pruebas (`requerimientos/04_Plan_de_Pruebas.md` §5). Comparten una app porque la subida necesita el hash. No es la app final.

**Criterio de PoC-05:** 50 fotos con cortes de red forzados, sin archivos perdidos ni corruptos y con los hashes coincidentes.

**Criterio de PoC-06:** SHA-256 de un original de 6 MB en menos de 1 s por foto, en un Android de gama media.

## Qué hace

- **Fotos sintéticas:** datos aleatorios de 3 a 8 MB, y la última de 25 MB (el máximo permitido). Trozos de 5 MB sobre tusd + S3 (doc. 03 §10).
- **Subida:** en orden, con reintentos sin límite. La URL de cada subida se guarda en el celular para reanudar tras cerrar la app.
- **Verificación:** `scripts/verificar.sh` descarga lo que quedó en S3 y recalcula cada SHA-256.
- **Medir hash:** 10 mediciones por streaming, leyendo de a 1 MB.

## Compilar y levantar el servidor

```
pnpm install
pnpm apk                       # android/app/build/outputs/apk/release/app-release.apk
scripts/servidor.sh limpiar    # MinIO + tusd en el puerto 1080. Borra los datos de la prueba anterior
```

La imagen oficial de MinIO ya no se puede descargar de Docker Hub ni de quay.io. Se usa la de Chainguard, fijada por digest.

## Probar en un celular real

La Mac y el celular deben estar en la misma WiFi. Si macOS lo pregunta, permitir conexiones entrantes a Docker.

1. Instalar `dist/poc-05-06-subida.apk`.
2. **PoC-06:** tocar **Medir hash** y enviar una captura junto con el modelo del celular.
3. **PoC-05:** escribir `http://<IP de la Mac>:1080` como servidor y tocar **Generar fotos** y luego **Subir**. Mantener la pantalla encendida.
4. Durante la subida, cortar varias veces: activar y quitar el modo avión, salir del alcance del WiFi y cerrar la app desde recientes. Al reabrir la app, tocar **Continuar subida**.
5. Al ver "terminada", correr `scripts/verificar.sh 50`.

En iPhone: ver requisitos e instalación en el [README de la raíz](../../README.md) y seguir "Ver indicaciones" en la app. Al generar las fotos, aceptar el permiso de red local.

## Prueba automática en el emulador

Con la app abierta, un lote recién generado y el servidor `http://10.0.2.2:1081`:

```
scripts/cortes.sh 15 500000    # corta cada 15 s, con un proxy de 500 KB/s
scripts/verificar.sh 50
```

## Resultados hasta ahora

Android (emulador en una Mac con Apple Silicon; no vale para aprobar):

| Prueba | Resultado |
|---|---|
| Subida sin cortes | 50 de 50 verificados |
| 15 cortes: 4 de modo avión, 4 de caída de tusd, 4 de tusd congelado, 3 de app cerrada a la fuerza | 50 de 50 verificados, 0 perdidos, 0 corruptos, 0 subidas duplicadas |
| Memoria durante la subida | Estable, de 90 a 110 MB, incluso con el archivo de 25 MB |
| Hash de 6 MB | Mediana de 12 ms. Este procesador es mucho más rápido que un celular de gama media |

Android real, Xiaomi 2209116AG (Snapdragon 732G, 8 GB, Android 13):

| Prueba | Resultado |
|---|---|
| Hash de 6 MB (PoC-06) | Mediana de 76 ms, máximo de 106 ms en 10 mediciones. Cumple el límite de 1 s |
| Subida por WiFi con cortes hechos a mano (PoC-05) | 50 de 50 verificados, 0 perdidos, 0 corruptos, 0 duplicados, 14 reintentos, 2 cierres de app. Cumple |

iOS: compila para el simulador; no se ejecutó. Hay que probarlo en un iPhone real.

En Xiaomi hay que activar "Instalar vía USB" en Opciones de desarrollador para instalar por cable. Para que la Mac toque la pantalla también hace falta "Depuración USB (ajustes de seguridad)".

## Hallazgos para la app final

- **`tus-js-client` no recuerda la URL en React Native:** la app debe guardarla apenas exista, o una app cerrada empieza de cero. Conviene guardarla en op-sqlite.
- **Hace falta un límite de tiempo sin avance:** con el servidor mudo, la subida se queda colgada sin error. Con un límite de 30 s se recuperó las 5 veces que hizo falta.
- **Los reintentos deben ser de la app:** con `retryDelays: null` y un ciclo propio, un corte largo nunca descarta el archivo.
- **`readBytes` asíncrono:** no bloquea la interfaz mientras lee el archivo.
- **Sin probar:** la subida con la app en segundo plano o la pantalla apagada. Aquí la app estuvo siempre en primer plano, y hay que definir este comportamiento antes de construir el módulo `subida`.
- **Sin probar:** el rechazo de un hash incorrecto y la validación de tipo por contenido. Son trabajo del worker en Fase 1.
