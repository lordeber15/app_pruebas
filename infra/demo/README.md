# Demo en su VPS

Instala la plataforma completa en un VPS con Docker: web, API, worker, base de datos, almacenamiento de fotos y subida reanudable. Todo queda detrás de **un solo puerto**, que usted publica con su Nginx Proxy Manager (u otro proxy) en su dominio con HTTPS.

Es un ambiente de **demo o staging**: use datos de prueba, no datos reales de campo.

## Requisitos

- VPS Linux x86_64 (amd64) con Docker Engine y Docker Compose v2. Con 4 GB de RAM alcanza para la demo.
- Un dominio o subdominio apuntando al VPS (por ejemplo `demo.suempresa.pe`).
- Nginx Proxy Manager, u otro proxy que ponga el certificado HTTPS.

## Instalar

En el VPS:

```
git clone https://github.com/lordeber15/app_pruebas.git
cd app_pruebas
cp infra/demo/.env.example infra/demo/.env
chmod 600 infra/demo/.env
nano infra/demo/.env          # llene los valores (vea la tabla)
docker compose -f infra/demo/docker-compose.demo.yml up -d --build
```

Variables de `infra/demo/.env`:

| Variable | Qué poner |
|---|---|
| `DOMINIO` | Su dominio sin `https://`, por ejemplo `demo.suempresa.pe` |
| `PUERTO_WEB` | Puerto del VPS que usará el proxy (por defecto `8080`) |
| `DB_HOST` | `postgres` (la base corre en Docker; no lo cambie) |
| `DB_PORT` | `5432` (no lo cambie) |
| `DB_NAME` | Nombre de la base (por defecto `campo`) |
| `POSTGRES_PASSWORD` | Clave del superusuario `postgres` |
| `APP_MIGRATOR_PASSWORD` | Clave del usuario `app_migrator` (migraciones) |
| `APP_RW_PASSWORD` | Clave del usuario `app_rw` (API) |
| `WORKER_RW_PASSWORD` | Clave del usuario `worker_rw` (worker) |
| `APP_RO_PASSWORD` | Clave del usuario `app_ro` (solo lectura) |
| `S3_ACCESS_KEY_APP` / `S3_SECRET_KEY_APP` | Usuario y clave del almacenamiento de fotos (MinIO) |
| `BETTER_AUTH_SECRET` | Firma de sesiones: `openssl rand -hex 32` |
| `TUSD_HOOK_SECRET` | Secreto interno de la subida: `openssl rand -hex 24` |

- Las claves llevan solo letras y números (van dentro de una URL). Genérelas con `openssl rand -hex 24`.
- Los usuarios de la base se crean solos en el primer arranque, con esas claves. No las cambie después: quedan fijadas en el volumen.
- Atajo: `infra/demo/preparar.sh demo.suempresa.pe 8080` crea el mismo `.env` con claves aleatorias.
- La primera construcción tarda unos minutos.

Compruebe que todo esté arriba. `migraciones` y `crear-bucket` deben figurar como terminados ("Exited (0)") y el resto en ejecución:

```
docker compose -f infra/demo/docker-compose.demo.yml ps -a
```

## Publicar con Nginx Proxy Manager

Cree un *Proxy Host*:

| Campo | Valor |
|---|---|
| Domain Names | `demo.suempresa.pe` (el mismo que pasó a `preparar.sh`) |
| Scheme | `http` |
| Forward Hostname / IP | IP del VPS. Si Nginx Proxy Manager corre en Docker en el mismo VPS, la IP del host en la red de Docker (normalmente `172.17.0.1`) |
| Forward Port | `8080` (o el puerto que eligió) |
| SSL | Certificado Let's Encrypt, **Force SSL** y **HTTP/2** activados |

En la pestaña **Advanced**, agregue esta línea para permitir fotos de hasta 25 MB:

```
client_max_body_size 30m;
```

El dominio debe ser exactamente el de `preparar.sh`. Las URL firmadas de las fotos y la sesión dependen de él.

## Primer ingreso

1. Cree el primer usuario de Coordinación. La contraseña temporal se muestra una sola vez:

   ```
   docker compose -f infra/demo/docker-compose.demo.yml run --rm api \
     node src/crear-coordinacion.ts DNI 12345678 "Nombre Apellido"
   ```

2. Entre a `https://demo.suempresa.pe` con el DNI y la contraseña temporal del paso 1. Le pedirá crear una propia: al menos 8 caracteres con mayúscula, minúscula y número.

3. Cree el proyecto con **Nuevo proyecto** y, dentro de él, en **Estaciones**, pulse **Cargar configuración TOCE (D01 y A01)**. Crea los 33 métodos, las 102 estaciones, las brigadas, el cronograma base y las reservas, y muestra el resumen. Repetirla no duplica nada.

   También puede hacerse por consola:

   ```
   docker compose -f infra/demo/docker-compose.demo.yml run --rm api \
     node ../../packages/db/src/cargar-toce.ts --crear "TOCE"
   ```

## Circuito de la demo

1. **Usuarios**: cree a los especialistas (rol *Personal de campo*). Cada alta muestra su contraseña temporal una sola vez; la persona crea la suya en su primer ingreso, en la web o en el celular.
2. **Proyectos → TOCE → Brigadas**: agregue a cada especialista a su brigada, por ejemplo SELVA 2, con el rol *Especialista* o *Supervisor de campo*. El *Jefe de Brigada* es el rol logístico y no ejecuta métodos.
3. **Proyectos → TOCE → Estaciones**: revise las estaciones de A01 con sus atributos (región, UV, AID/AII, ZA/EF) en el mapa y en la tabla.
4. En el celular: instale el APK, escriba `https://demo.suempresa.pe` como servidor e ingrese con el especialista. La app descarga el paquete de campo de su brigada.
5. En el celular, siga el flujo **Estación → Especialidad → Método → Unidad → Ejecución**: vea lo que D01 exige al iniciar el método, registre unidades con su geometría, fotos de contexto y datos, y use **Revisar y cerrar**. Funciona sin señal; sincronice al volver.
6. En la web, **Revisiones** muestra lo que llegó tarde a una ejecución ya cerrada para conservarlo o descartarlo.

⚑ En construcción: tablero de avance por brigada, estación y método; alertas; cronograma vigente y aprobación de cambios; galería; y la validación post-sincronización contra D01. Hasta entonces, una ejecución cerrada queda en *evidencia pendiente*.

## Actualizar una demo existente

Desde la carpeta del repositorio:

```
git pull
docker compose -f infra/demo/docker-compose.demo.yml up -d --build
```

Las migraciones se aplican solas y no borran nada:

- **Datos del modelo anterior** (cuadernos, tareas y asignaciones): quedan guardados sin uso.
- **Roles:** el supervisor pasa a Coordinación y el logístico o jefe de cada brigada pasa a Jefe de Brigada.
- **Contraseñas:** todos los usuarios existentes deberán crear una contraseña propia en su próximo ingreso.

Después cargue TOCE con el paso 3 de *Primer ingreso* si aún no lo hizo.

## Mapa base

Sin mapa base, la web muestra las estaciones sobre un fondo neutro. Para ver el terreno, copie el archivo `base.pmtiles` en `infra/demo/mapa/` de la VPS. No hace falta reiniciar ni reconstruir.

El archivo no está en git (pesa 210 MB). Se genera en cualquier equipo con Docker, desde la raíz del repositorio. Este comando extrae todo el Perú hasta el zoom 13 desde el mapa público de Protomaps (OpenStreetMap):

```
docker run --rm -v "$PWD/infra/demo/mapa:/out" protomaps/go-pmtiles extract \
  https://build.protomaps.com/20261106.pmtiles /out/base.pmtiles \
  --bbox=-81.4,-18.4,-68.6,-0.0 --maxzoom=13
```

Si esa fecha ya no existe, use una reciente con el formato `AAAAMMDD`. Luego súbalo a la VPS, por ejemplo con `scp infra/demo/mapa/base.pmtiles usuario@su-vps:/ruta/del/repo/infra/demo/mapa/`.

## Operación

| Acción | Comando (desde la carpeta del repositorio) |
|---|---|
| Ver registros | `docker compose -f infra/demo/docker-compose.demo.yml logs -f api worker` |
| Actualizar a una versión nueva | `git pull` y luego `docker compose -f infra/demo/docker-compose.demo.yml up -d --build` (aplica las migraciones solo) |
| Detener | `docker compose -f infra/demo/docker-compose.demo.yml down` (conserva los datos) |

Los datos viven en los volúmenes `campo-demo_postgres` y `campo-demo_minio`. `down -v` **los borra sin vuelta atrás**. No borre `infra/demo/.env` si conserva los volúmenes: las contraseñas de la base de datos quedaron fijadas en ellos.

## Lo que esta demo no incluye

- Respaldos automáticos ni monitoreo (doc. 05 §16 y §18).
- WireGuard ni endurecimiento del servidor (doc. 05 §5 a §7).
- Notificaciones push.

Antes de usar datos reales hay que completar esos puntos y el checklist del doc. 05 §21.
