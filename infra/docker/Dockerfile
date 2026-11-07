# syntax=docker/dockerfile:1
# Imágenes de la plataforma (doc. 05 §9). Un solo Dockerfile con un destino por servicio:
#   --target servidor  → API, worker y migraciones (Node 24 ejecuta el TypeScript directamente)
#   --target web       → nginx con la web compilada y el proxy de /api, /files y /archivos
# Imágenes base fijadas por digest (CLAUDE.md, Arquitectura).

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

FROM fuente AS servidor
ENV NODE_ENV=production
# Sin privilegios de root en ejecución.
USER node
