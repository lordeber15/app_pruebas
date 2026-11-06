# Demo en su VPS

Instala la plataforma completa en un VPS con Docker: web, API, worker, base de datos, almacenamiento de fotos y subida reanudable. Todo queda detrás de **un solo puerto**, que usted publica con su Nginx Proxy Manager (u otro proxy) en su dominio con HTTPS.

Es un ambiente de **demo o staging**: use datos de prueba, no datos reales de campo.

## Requisitos

- VPS Linux x86_64 (amd64) con Docker Engine y Docker Compose v2. Con 4 GB de RAM alcanza para la demo.
- Un dominio o subdominio apuntando al VPS (por ejemplo `demo.suempresa.pe`).
- Nginx Proxy Manager, u otro proxy que ponga el certificado HTTPS.

## Instalar

En el VPS, dentro de la carpeta del repositorio:

```
infra/demo/preparar.sh demo.suempresa.pe 8080
docker compose -f infra/demo/docker-compose.demo.yml up -d --build
```

- `preparar.sh` genera claves aleatorias en `infra/demo/.env` (permisos 600, fuera de git). El segundo valor es el puerto interno que usará el proxy; por defecto, 8080.
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

Cree el primer supervisor. La contraseña temporal se muestra una sola vez:

```
docker compose -f infra/demo/docker-compose.demo.yml run --rm api \
  node src/crear-supervisor.ts DNI 12345678 "Nombre Apellido"
```

Entre a `https://demo.suempresa.pe` con ese DNI y esa contraseña. Desde **Usuarios** cree al resto de las personas. Cada alta muestra su contraseña temporal una sola vez.

## Circuito de la demo

1. **Usuarios**: cree a un especialista (rol *Personal de campo*).
2. **Proyectos**: cree un proyecto. Marque la validación si quiere mostrar la validación de tareas.
3. **Equipo y cuadernos**: cree una cuadrilla, elija su jefe, agregue al especialista y cree un cuaderno con él como responsable.
4. **Estaciones**: cree una metodología (por ejemplo, Trampas Sherman en trampas-noche), una estación y programe la metodología con una meta.
5. **Centro de tareas**: cree tareas en el cuaderno, con su estación y metodología o con coordenadas.
6. En el celular: instale el APK, escriba `https://demo.suempresa.pe` como servidor, ingrese con el especialista y descargue las tareas. Trabaje sin señal si quiere: fotos, puntos de evidencia y esfuerzo. Complete la tarea y sincronice.
7. En la web: la tarea pasa por *Evidencia en tránsito* hasta *Completada* cuando llega la foto. Ábrala, revise las fotos y valídela u obsérvela. Vea el **Avance** y el **Mapa**.

## Mapa base (opcional)

Sin mapa base, la web muestra las tareas y estaciones sobre un fondo neutro. Para ver el terreno, copie un archivo PMTiles con el nombre `base.pmtiles` en `infra/demo/mapa/`. No hace falta reiniciar.

- El de PoC-01 cubre Lima (19 MB): `poc/poc-01-mapa/assets/mapa/base.pmtiles`.
- Para otra zona, genérelo con `poc/poc-01-mapa/scripts/generar-datos.sh` (vea su README).

## Operación

| Tarea | Comando (desde la carpeta del repositorio) |
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
