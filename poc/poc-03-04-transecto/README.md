# PoC-03 y PoC-04: transecto y batería

Pruebas desechables del plan de pruebas (`requerimientos/04_Plan_de_Pruebas.md` §5). Comparten una app porque la jornada de batería incluye el transecto. No es la app final.

**Criterio de PoC-03:** al menos 95 % de los puntos esperados, sin cortes, en un transecto de 1 a 2 h con la pantalla apagada, en las 3 marcas Android y en iOS. Si falla: comprar Transistor (ADR-011).

**Criterio de PoC-04:** terminar una jornada de 8 h (cercanía + 1 h de transecto + 30 fotos + 10 audios) con al menos 20 % de batería, sin batería externa, en un Android de gama media. Si falla: ajustar intervalos o el plan B.

## Qué hace

- **Transecto:** guarda latitud, longitud, altitud, precisión y hora cada ~15 m o cada 15 a 20 s, con una notificación fija mientras está activo.
- **Puntos esperados:** se espera al menos un punto en cada ventana de 20 s. La pantalla muestra el porcentaje cubierto y el mayor hueco.
- **Jornada:** activa el mismo aviso de cercanía de PoC-02, con 60 tareas sintéticas.
- **Evidencias:** toma fotos reales con la cámara y graba audios de 30 s (AAC mono, 48 kbps).

**Excepción de esta prueba:** igual que en PoC-02, guarda en el celular las tareas generadas alrededor de usted y la distancia al avisar. Nada sale del celular. El consentimiento para transectos (⚑ C3) todavía no está aprobado: usar solo con quien hace la prueba.

## Compilar

```
pnpm install
pnpm apk    # android/app/build/outputs/apk/release/app-release.apk
```

## Preparar el Android

1. Instalar `dist/poc-03-04-transecto.apk` y aceptar notificaciones y ubicación. Elegir **"Permitir siempre"**.
2. Encender **Precisión de ubicación de Google** para el aviso de cercanía.
3. Dejar la optimización de batería **como viene** en la primera corrida, y anotar si hubo que cambiarla. Ese dato es parte del resultado (BAT-02).

## PoC-03: prueba en terreno

Repetir en cada marca Android y en el iPhone:

1. Tocar **Iniciar transecto**, apagar la pantalla y guardar el celular en el bolsillo.
2. Caminar de 1 a 2 h al aire libre, sin abrir la app. Al menos una corrida en modo avión.
3. Volver a la app, tocar **Terminar transecto** y enviar una captura junto con el modelo del celular.

| Se aprueba si | Valor |
|---|---|
| Puntos esperados cubiertos | ≥ 95 % |
| Mayor hueco | Cerca de 20 s; un hueco de minutos es un corte, aunque el porcentaje cumpla |

## PoC-04: jornada de 8 h

Un Android de gama media, cargado al 100 % y sin batería externa:

| Momento | Acción |
|---|---|
| Inicio | Anotar hora y batería. Tocar **Abrir jornada** |
| Durante el día | 1 h de transecto, 30 fotos, 10 audios |
| Durante el día | 30 min de mapa con la app de PoC-01 (BAT-01) |
| A las 8 h | Anotar la batería y tocar **Cerrar jornada** |

Se aprueba con 20 % o más. Anotar el brillo, la temperatura y si hubo señal: cambian mucho el consumo.

## Resultados hasta ahora

Android (emulador con GPS simulado; no vale para aprobar):

| Prueba | Resultado |
|---|---|
| Transecto de 10 min: pantalla apagada, modo avión y reposo profundo forzado | 100 % (30 de 30), 41 puntos, hueco máximo de 16 s |
| Cercanía, transecto, 2 fotos y 1 audio a la vez | Funcionan sin errores |

Android real, Xiaomi 2209116AG (Snapdragon 732G, Android 13), con modo avión y batería como viene:

| Prueba | Resultado |
|---|---|
| Transecto de 91 min a pie | 96 % (263 de 272), 336 puntos, precisión mediana de 8 m, hueco máximo de 109 s. Cumple. El usuario pasó por zonas techadas y edificios altos, lo que puede explicar el hueco; la app no registra cuándo ocurrió |

Jornada de batería en el mismo Xiaomi (2026-11-02, datos del historial de batería del sistema):

| Dato | Resultado |
|---|---|
| Batería | 92 % a las 06:57, sin cargar; 91 % a las 08:11; 73 % a las 20:26 |
| Carga de trabajo | Transecto de 97 min (98 %, hueco máximo de 60 s), 31 fotos, 17 audios |
| Condiciones | Jornada abierta a las 06:57 según informa el usuario, modo avión, brillo automático, pantalla encendida 21 min, mapa 2 min, temperatura máxima de 31,5 °C |
| PoC-04 | Cumple: 73 % tras 13,5 h, partiendo de 92 % |

En este transecto la app se abrió seguido para tomar fotos y audios, así que no sustituye la corrida de PoC-03 con la pantalla apagada. La carga real de pantalla fue baja: el margen no vale para un día con mucho uso de pantalla.

iOS: compila para el simulador; no se ejecutó.

## Hallazgos para la app final

- **En Android, `timeInterval` y `distanceInterval` se exigen a la vez:** para cumplir "~15 m o ~20 s" hay que leer seguido y filtrar en la app.
- **La hora del GPS y el reloj del celular difieren:** en el emulador, unos 89 s. Los huecos se miden con un solo reloj; esto respalda que `hora_dispositivo` sea solo un dato (RN-09).

## iPhone

Requisitos e instalación: ver el [README de la raíz](../../README.md). En resumen, `pnpm install` y `pnpm expo run:ios --device --configuration Release`.

1. Elegir ubicación **"Siempre"** con **"Ubicación exacta"** y desactivar el Modo de bajo consumo.
2. Seguir la sección de PoC-03 de "Ver indicaciones". En iPhone no se debe cerrar la app desde el selector de apps, porque eso detiene el transecto.
3. PoC-04 se mide solo en Android.
