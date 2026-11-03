# PoC-02: aviso de cercanía

Prueba desechable del plan de pruebas (`requerimientos/04_Plan_de_Pruebas.md` §5). No es la app final.

**Criterio de aprobación:** aviso en 60 s o menos al entrar en el radio de 100 m, con la app cerrada y sin señal, en Android e iOS. Además, las zonas KMZ avisan con la app activa, y con 60 tareas se vigilan las 20 más cercanas y la lista se actualiza al moverse (CP-018 a CP-020).

## Qué hace

- **Abrir jornada:** toma su posición y genera 60 tareas de prueba a partir de 300 m a su alrededor, y una zona de 200 × 200 m que empieza 150 m al sur.
- **Con la app cerrada:** el sistema vigila las 20 tareas más cercanas (19 en iOS, porque el perímetro ocupa la región 20). Al salir del perímetro, recalcula la lista.
- **Con la app activa:** compara su posición con la zona.
- **Bitácora:** muestra la hora de cada aviso y la distancia a la que estaba (solo tareas, si hay posición disponible).

**Excepción de esta prueba:** para poder medir, guarda en el celular las tareas generadas alrededor de usted y la distancia al avisar. La app final recibe las tareas del servidor y no guarda nada de esto (RN-14). No sale nada del celular.

## Compilar

```
pnpm install
pnpm apk    # android/app/build/outputs/apk/release/app-release.apk
```

## Preparar el Android

1. Instalar `dist/poc-02-cercania.apk` y aceptar notificaciones y ubicación. Elegir **"Permitir siempre"** en los ajustes.
2. Encender **Precisión de ubicación de Google** (Ajustes → Ubicación → Servicios de ubicación). Sin ella, los avisos con la app cerrada **no llegan y no aparece ningún error**.
3. Desactivar la optimización de batería para esta app. En Xiaomi o Huawei, permitir además el inicio automático.
4. Tocar "Probar aviso" y verificar que aparece.

## Prueba en terreno

Hacerla al aire libre, a pie, y anotar los resultados de la bitácora.

| # | Pasos | Se espera |
|---|---|---|
| 1 | Con la app abierta, abrir la jornada y caminar 150 m al sur | Aviso "Zona de trabajo" |
| 2 | Abrir la jornada, cerrar la app desde recientes, activar modo avión y caminar | Aviso de tarea con la pantalla apagada |
| 3 | Repetir sin modo avión | Aviso de tarea |
| 4 | Con la app cerrada, alejarse más de 1,5 km | "Lista recalculada" en la bitácora |
| 5 | Reiniciar el celular con la jornada abierta y caminar | Anotar si sigue avisando |
| 6 | Cerrar la jornada y caminar | Ningún aviso |

**Medir la demora:** la bitácora indica a cuántos metros estaba al recibir el aviso. Caminando a unos 1,4 m/s, un aviso en 60 s recorre unos 84 m: estar a **unos 20 m o más** cumple el criterio, y a menos de eso es una señal de demora. Si el aviso no incluye distancia, anotar la hora y comparar con un cronómetro.

## Probar en iPhone

Requisitos e instalación: ver el [README de la raíz](../../README.md). En resumen, `pnpm install` y `pnpm expo run:ios --device --configuration Release`.

1. Elegir ubicación **"Siempre"** con **"Ubicación exacta"** y desactivar el Modo de bajo consumo.
2. Repetir la tabla siguiendo "Ver indicaciones": en iPhone la app se cierra deslizándola hacia arriba en el selector de apps.

## Resultados hasta ahora

Android (emulador con GPS simulado; no vale para aprobar):

| Prueba | Resultado |
|---|---|
| Zona con la app activa, modo avión | Avisa |
| Tarea con la app abierta | Avisa unos 8 s después de entrar, según la bitácora |
| Tarea con la app cerrada, modo avión, otra app pidiendo GPS | Avisa unos 4 s después de entrar; el sistema inició el proceso de la app |
| Tarea con la app cerrada y nadie pidiendo GPS | Sin aviso en 11 min; salió al abrir la app. El emulador no entrega posiciones sin un pedido activo, y falta ver qué hace un celular real |
| Lista recalculada al salir del perímetro, con la app cerrada | Funciona; 20 tareas vigiladas |

Android real, Xiaomi 2209116AG (Snapdragon 732G, Android 13), última jornada abierta:

| Prueba | Resultado |
|---|---|
| Avisos de tarea a pie, con la app cerrada y modo avión | 5 avisos, a unos 70, 90, 90, 90 y 100 m. Superan los ~20 m que exige el criterio |
| Lista recalculada | 1 vez, 20 tareas vigiladas |
| Zona con la app abierta, reinicio y jornada cerrada | Correctos según informa el usuario; sin evidencia en la bitácora |

**Abrir una jornada borra la bitácora anterior:** anotar o capturar los resultados antes de abrir otra. La bitácora tampoco registra si la app estaba cerrada o en modo avión.

iOS: compila y abre en el simulador; las geovallas no se probaron. Hay que hacerlo en un iPhone real.

## Hallazgos para la app final

- **Geovallas de Android dependen de la Precisión de ubicación de Google:** apagada, `startGeofencingAsync` termina bien y `hasStartedGeofencingAsync` devuelve `true`, pero nunca llega un evento. `expo-location` no escucha el rechazo de `addGeofences`. La app debe detectarlo o indicar cómo activarlo.
- **Sin red, no usar precisión baja:** `getCurrentPositionAsync` con `Balanced` no termina nunca en modo avión. Usar `Highest`, con un límite de espera y `getLastKnownPositionAsync` como respaldo.
- **`watchPositionAsync` también necesita `mayShowUserSettingsDialog: false`:** sin eso, se rechaza en modo avión.
- **El aviso va antes de leer la posición:** el sistema limita el tiempo de la tarea en segundo plano.
- **Recálculo duplicado:** una salida del perímetro generó dos recálculos seguidos. No causa daño, pero la app final debe ignorar el repetido.
- **iOS:** el perímetro ocupa una de las 20 regiones, así que se vigilan 19 tareas y no 20 como dice RN-14.
