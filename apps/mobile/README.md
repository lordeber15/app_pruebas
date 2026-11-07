# App de campo (Android)

App móvil offline-first para el personal de campo del proyecto TOCE. Sigue el modelo visible de D02: **Estación → Especialidad → Método → Unidad → Ejecución**. Trabaja sin señal y sincroniza cuando hay conexión.

## Qué hace esta versión (demo)

- **Primer ingreso:** pide la dirección del servidor (`https://…`), el documento y la contraseña. Activa el celular con un par de llaves propio y pide un PIN de 6 dígitos.
- **Paquete de campo:** con conexión, descarga lo de la brigada del usuario: cronograma vigente, estaciones con sus atributos de A01, métodos con su configuración D01 y la matriz estación–método. Se actualiza en cada sincronización.
- **Inicio:** las estaciones de hoy, después las próximas fechas; las anteriores siguen disponibles. Cada estación muestra UV, AID/AII, ZA/EF y lo que usted ya hizo en ella.
- **Estación:** sus atributos de A01, que nunca se piden (CA-20), y los métodos habilitados por especialidad. Los registros oportunos van aparte. Los condicionales por confirmar se listan sin poder iniciarse.
- **Inicio de método:** lo que D01 define, agrupado por tipo de control. «Se exige» (cuadrado lleno) agrupa lo obligatorio. «Advertencias» (triángulo) no impiden cerrar. «Referencias y criterio de campo» (círculo) orientan, y la información va al final.
- **Ejecución:** avance contra el objetivo aplicable (estándar, ZA/EF o por región). Lista las unidades con lo primero que les falta y las fotos metodológicas.
- **Unidad:** la geometría exacta del método: punto, inicio y fin, vértices o parcela forestal con subparcelas. También hora de inicio y fin, track en los métodos que lo exigen, fotos de contexto guiadas N-S-E-O, campos de D01, filas de registros, vínculo con otro método y parámetros del detector.
- **Revisar y cerrar:** el mismo motor de reglas del servidor (`core`). Si falta algo obligatorio, solo se cierra declarando una desviación con explicación. Incluye la confirmación ZA/EF de cámaras trampa y el número final de unidades en bofedales.
- **Sincronizar:** al volver la conexión y cada 2 minutos. Primero envía los eventos y después las fotos, empezando por las de ejecuciones cerradas. Cada foto se borra del celular solo cuando el servidor confirmó su hash.

## Limitaciones conocidas

- ⚑ **Track con la pantalla apagada:** el track se graba solo con la pantalla de la unidad abierta. Para grabar en segundo plano (CA-10) falta aprobar `expo-task-manager` y compilar un binario nuevo.
- Mapa sin conexión, aviso de cercanía (P-16), alertas desde campo, vista del Jefe de Brigada, notas de voz, fichas, checklist logístico y fotos originales con WiFi.

## Compilar el APK

Requiere el SDK de Android y Java 17 (los mismos de las PoC).

```
pnpm install
cd apps/mobile
pnpm apk
```

El APK queda en `android/app/build/outputs/apk/release/app-release.apk`. Está firmado con la llave de depuración: sirve para la demo, no para la tienda.

La app solo acepta servidores con `https://`. En la demo, el HTTPS lo pone el proxy del VPS (vea `infra/demo/README.md`).
