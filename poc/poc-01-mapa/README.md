# PoC-01: mapa sin conexión

Prueba desechable del plan de pruebas (`requerimientos/04_Plan_de_Pruebas.md` §5). No es la app final.

**Criterio de aprobación:** se muestra y navega a más de 30 FPS en un Android de gama media, en modo avión, con un paquete menor a 200 MB.

## Regenerar los datos

Requiere Docker. Los datos no se guardan en git.

```
[CAMPOS=a,b,c] scripts/generar-datos.sh "<ruta>/archivo.kmz|kml" [bbox] [maxzoom] [build_protomaps]
pnpm estilo
```

Por defecto usa todo el Perú hasta zoom 13. `CAMPOS` limita los atributos que se conservan. La app toma el encuadre de `src/area.json`, que genera el script.

| Paquete | Comando | Tamaño | APK |
|---|---|---|---|
| Lima, 10 puntos | `CAMPOS=Name,description scripts/generar-datos.sh ejemplos/puntos-lima.kml "-77.2,-12.25,-76.85,-11.9" 15` | 19 MB | 74 MB |
| Perú, acuíferos (peor caso) | `CAMPOS=TIPO,EDAD,LITOLOGIA,NOMBRE,CODIGO scripts/generar-datos.sh "<ruta>/Acuifero - ANA - geogpsperu.kmz"` | 154 MB | 204 MB |

Los dos APK en `dist/` comparten identificador: instalar uno reemplaza al otro. El APK nacional de `dist/` se compiló antes de estos cambios y no dibuja puntos ni calcula su encuadre.

## Compilar

```
pnpm install
pnpm apk    # android/app/build/outputs/apk/release/app-release.apk
```

El APK está firmado con la llave de depuración: sirve solo para esta prueba.

## Probar en Android

1. Instalar el APK, abrir la app una vez y aceptar el permiso de ubicación.
2. Activar el modo avión y volver a abrir la app.
3. Verificar: mapa base, polígonos del KMZ, atributos al tocar un polígono y "Mi ubicación" (al aire libre).

**Medir FPS** (celular conectado por USB con depuración activada):

1. Tener la app abierta en el mapa.
2. Ejecutar `scripts/medir-fps-android.sh` y tocar "Recorrido de prueba" al instante.
3. Anotar el promedio, el mínimo y los segundos con 30 FPS o más.

## Probar en iPhone

1. Abrir `ios/PoCMapa.xcworkspace` en Xcode, elegir su cuenta en Signing & Capabilities y el iPhone conectado por cable.
2. Para ver FPS: en Edit Scheme → Run → Options, activar Metal HUD (o la variable `MTL_HUD_ENABLED=1`).
3. Compilar en configuración Release y repetir la prueba en modo avión.

## Hallazgos para la app final

- **Ubicación sin red:** en Android, `expo-location` rechaza la solicitud en modo avión salvo que se pase `mayShowUserSettingsDialog: false`. Aplica también a PoC-02 y PoC-03.
- **Medición de FPS:** `onDidFinishRenderingFrame` subestima los cuadros (8 frente a más de 30 reales); no usarlo para medir.
- **KMZ:** el lector KML básico de GDAL pierde los atributos `SimpleData`; hay que usar LIBKML. Conviene que `apps/worker` lo tenga en su imagen.
- **Glifos:** el mapa base necesita fuentes locales para mostrar etiquetas sin conexión; deben ir en el paquete cartográfico.
- **Área fuera del recorte:** se ve gris. La cámara debe limitarse con `maxBounds` y `minZoom`.
- **Actualizar un paquete:** la app no debe reutilizar archivos por nombre; cada paquete necesita su propio identificador o se seguirían mostrando los datos anteriores.
- **Compilar iOS:** `xcodebuild` puede quedarse en `Resolve Package Graph` descargando el binario de MapLibre, sin error y sin límite de tiempo. Se resuelve descargando el ZIP de la URL de su `Package.swift`, comprobando el checksum y copiándolo en `~/Library/Caches/org.swift.swiftpm/artifacts/`, con los signos de la URL reemplazados por `_`. CI debe tener un límite de tiempo.
