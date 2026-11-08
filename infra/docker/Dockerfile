# syntax=docker/dockerfile:1
# Imágenes de la plataforma (doc. 05 §9). Un solo Dockerfile con un destino por servicio:
#   --target servidor  → API, worker y migraciones (Node 24 ejecuta el TypeScript directamente)
#   --target web       → nginx con la web compilada y el proxy de /api, /files y /archivos
# Imágenes base fijadas por digest (CLAUDE.md, Arquitectura).

# Arquitectura destino (la pone BuildKit): elige el binario de go-pmtiles.
ARG TARGETARCH

FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS base
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH TZ=UTC
RUN npm install -g pnpm@12.18.0 && npm cache clean --force
WORKDIR /app

# Solo los manifiestos primero: la capa de dependencias se reutiliza mientras no cambien.
FROM base AS dependencias
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM dependencias AS fuente
COPY packages packages
COPY apps apps

FROM fuente AS web-compilada
RUN pnpm --filter @campo/web build

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS web
COPY infra/demo/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-compilada /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

# go-pmtiles v1.31.2 (recorta los paquetes de mapa sin conexión, RF-M05). Descarga verificada
# por SHA-256: si el archivo cambia, el build falla.
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS pmtiles-amd64
ADD --checksum=sha256:3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f \
  https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_x86_64.tar.gz /tmp/pmtiles.tar.gz

FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS pmtiles-arm64
ADD --checksum=sha256:f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1 \
  https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_arm64.tar.gz /tmp/pmtiles.tar.gz

FROM pmtiles-${TARGETARCH} AS pmtiles
RUN tar -xzf /tmp/pmtiles.tar.gz -C /usr/local/bin pmtiles \
  && chmod 0755 /usr/local/bin/pmtiles \
  && /usr/local/bin/pmtiles version

FROM fuente AS servidor
ENV NODE_ENV=production
COPY --from=pmtiles /usr/local/bin/pmtiles /usr/local/bin/pmtiles
# Certificados raíz para que pmtiles lea una fuente https (la imagen slim no los trae).
COPY --from=nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de \
  /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
# Carpeta de trabajo de los recortes de mapa (el worker monta ahí un volumen; el resto es read_only).
RUN mkdir -p /var/tmp/mapas && chown node:node /var/tmp/mapas
# Sin privilegios de root en ejecución.
USER node
