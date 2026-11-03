# Acta de PoC (Fase 0)

Estado al 2026-10-31. **Decisión go/no-go: pendiente.** Faltan las pruebas en dispositivos reales, y el emulador no sirve para aprobar lo que depende del dispositivo.

| PoC | Criterio | Resultado hasta ahora | Estado | Falta |
|---|---|---|---|---|
| 01 Mapa | > 30 fps en Android de gama media; paquete < 200 MB | Se ve bien en el Android del usuario; paquete de 19 MB | Cerrada por decisión del usuario; fps sin medir | Nada |
| 02 Cercanía | Aviso en ≤ 60 s, app cerrada, Android e iOS | Xiaomi 2209116AG, a pie, app cerrada y modo avión: 5 avisos de tarea a unos 70–100 m (el mínimo para cumplir es ~20 m) y 1 lista recalculada. Según informa el usuario: aviso de zona con la app abierta, sigue avisando tras reiniciar y la jornada cerrada se comportó como debía | **Android: cumple.** iPhone: sin probar | Repetir en iPhone |
| 03 Transecto | ≥ 95 % de puntos en 1–2 h, pantalla apagada, 3 marcas Android e iOS | Xiaomi 2209116AG, 91 min a pie, modo avión y batería como viene: 96 % (263 de 272), 336 puntos, precisión mediana de 8 m, hueco máximo de 109 s. El usuario pasó por zonas techadas y edificios altos, lo que puede explicar el hueco; la app no registra cuándo ocurrió | **Xiaomi: cumple. Sin aprobar:** faltan marcas | Otras 2 marcas Android e iPhone |
| 04 Batería | ≥ 20 % tras 8 h | Xiaomi 2209116AG, 2026-11-02, sin cargar desde las 06:57: de 92 % a 73 % a las 20:26, con 97 min de transecto (98 %, hueco máximo de 60 s), 31 fotos y 17 audios. Jornada abierta a las 06:57 según informa el usuario. Modo avión; brillo automático; pantalla encendida 21 min; mapa 2 min; temperatura máxima de 31,5 °C | **Cumple** en Android de gama media. Carga de pantalla baja y sin señal | Nada para PoC-04. BAT-01 exige además 30 min de mapa y BAT-02 cada marca |
| 05 Subida | 50 fotos con cortes: 0 perdidos ni corruptos | Xiaomi 2209116AG por WiFi, con cortes hechos a mano: 50 de 50 verificados, 0 perdidos, 0 corruptos, 0 duplicados, 14 reintentos, 2 cierres de app. En emulador, 15 cortes con el mismo resultado | **Android: cumple.** iPhone: sin probar | Repetir en iPhone |
| 06 Hash | < 1 s por foto de 6 MB en gama media | Xiaomi 2209116AG (Snapdragon 732G, Android 13): mediana de 76 ms, máximo de 106 ms en 10 mediciones | **Android: cumple.** iPhone: sin medir | Medir en iPhone |

## Decisiones que dependen de este resultado

- **Compra de Transistor (ADR-011, ~US$ 399):** sin decidir. Depende de PoC-03 y, si el aviso falla en Android, también de PoC-02.
- **Inicio de Fase 1:** queda sujeto a la decisión go/no-go.

## Riesgos abiertos

1. **Aviso de cercanía en Android sin otra app usando GPS:** puede superar los 60 s.
2. **Subida en segundo plano:** no se probó y no está definido cómo debe comportarse.
3. **Imagen de MinIO:** la oficial ya no se puede descargar, y el documento 3 usa MinIO en el entorno local.

## Dónde está cada prueba

| PoC | Carpeta | APK |
|---|---|---|
| 01 | `poc-01-mapa/` | `dist/poc-01-mapa-lima.apk` |
| 02 | `poc-02-cercania/` | `dist/poc-02-cercania.apk` |
| 03 y 04 | `poc-03-04-transecto/` | `dist/poc-03-04-transecto.apk` |
| 05 y 06 | `poc-05-06-subida/` | `dist/poc-05-06-subida.apk` |

Cada carpeta tiene un README con los pasos de su prueba, y las apps de PoC-02 a PoC-06 los muestran en "Ver indicaciones".
