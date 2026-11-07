# App de campo (Android)

App móvil offline-first para el personal de campo: descarga sus tareas, trabaja sin señal (fotos, puntos de evidencia, esfuerzo, comentarios) y sincroniza cuando hay conexión.

## Qué hace esta versión (demo)

- **Primer ingreso:** pide la dirección del servidor (`https://…`), el documento y la contraseña. Activa el celular con un par de llaves propio y pide un PIN de 6 dígitos.
- **Sin señal:** el PIN abre la app. Todo se guarda primero en el celular y se envía después. La barra superior muestra siempre si hay conexión y cuánto falta enviar.
- **Jornada:** se abre y se cierra a mano.
- **Tareas nuevas:** se descargan con conexión. Usted elige cuáles; quedan reservadas en este celular.
- **En cada tarea:**
  - fotos con la cámara de la app, a 2 048 px, con hash y ubicación (no hay acceso a la galería);
  - puntos de evidencia;
  - esfuerzo, si la tarea tiene metodología;
  - comentarios.
- **Completar:** exige al menos una foto. La tarea queda en tránsito hasta que el servidor verifica la foto.
- **Sincronizar:** al volver la conexión y cada 2 minutos. Envía primero los eventos, luego las fotos de las tareas completadas y después las demás. Cada foto se borra del celular solo cuando el servidor confirmó su hash.
- **Cambios desde la web:**
  - una tarea reasignada a otra persona se marca como revocada;
  - una tarea observada vuelve para corregirla, con los comentarios del supervisor;
  - una baja remota borra los datos del celular.

## Pendiente para la siguiente versión

Mapa sin conexión, aviso de cercanía y transectos (probados en PoC-01 a PoC-04), notas de voz, fichas, checklist logístico, fotos originales con WiFi y bloqueo a los 15 días sin sincronizar.

## Compilar el APK

Requiere el SDK de Android y Java 17 (los mismos de las PoC).

```
pnpm install
cd apps/mobile
pnpm apk
```

El APK queda en `android/app/build/outputs/apk/release/app-release.apk`. Está firmado con la llave de depuración: sirve para la demo, no para la tienda.

La app solo acepta servidores con `https://`. En la demo, el HTTPS lo pone el proxy del VPS (vea `infra/demo/README.md`).
