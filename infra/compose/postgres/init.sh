#!/usr/bin/env bash
# Primer arranque de PostgreSQL (doc. 05 §12 y doc. 03 §11.1). Solo se ejecuta con el volumen vacío.
# El esquema `app` es de app_migrator; los permisos sobre las tablas se dan por defecto a
# app_rw, worker_rw y app_ro, y cada migración restringe lo que haga falta (por ejemplo `evento`).
set -euo pipefail

# Nombre de la base de la aplicación (DB_NAME en la demo); por defecto, campo.
DB_NAME="${DB_NAME:-campo}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$APP_MIGRATOR_PASSWORD" \
  -v rw_pw="$APP_RW_PASSWORD" \
  -v worker_pw="$WORKER_RW_PASSWORD" \
  -v ro_pw="$APP_RO_PASSWORD" \
  -v db="$DB_NAME" <<'SQL'
SET password_encryption = 'scram-sha-256';
CREATE ROLE app_migrator LOGIN PASSWORD :'migrator_pw';
CREATE ROLE app_rw LOGIN PASSWORD :'rw_pw';
CREATE ROLE worker_rw LOGIN PASSWORD :'worker_pw';
CREATE ROLE app_ro LOGIN PASSWORD :'ro_pw';
CREATE DATABASE :"db";
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB_NAME" \
  -v db="$DB_NAME" <<'SQL'
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO app_migrator, app_rw, worker_rw, app_ro;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE SCHEMA app AUTHORIZATION app_migrator;
GRANT USAGE ON SCHEMA app TO app_rw, worker_rw, app_ro;

-- pg-boss crea y administra su propio esquema.
GRANT CREATE ON DATABASE :"db" TO worker_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw, worker_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA app
  GRANT SELECT ON TABLES TO app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw, worker_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO app_rw, worker_rw;

ALTER ROLE app_migrator SET search_path = app, public;
ALTER ROLE app_rw SET search_path = app, public;
ALTER ROLE worker_rw SET search_path = app, public;
ALTER ROLE app_ro SET search_path = app, public;
SQL
