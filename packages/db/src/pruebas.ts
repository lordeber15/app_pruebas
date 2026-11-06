// Base de datos real para pruebas de integración (CLAUDE.md, Pruebas: sin simular la BD).
// Misma imagen, roles y migraciones que el entorno local. Solo para pruebas.
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { aplicarMigraciones } from './migraciones.ts';

const IMAGEN =
  'postgis/postgis:17-3.7@sha256:ca211960fbe54834dcb6ff16aae6d70f72f66f4a789820aed3d5691025c9d698';
const RAIZ = path.join(import.meta.dirname, '..', '..', '..');
export const CARPETA_MIGRACIONES = path.join(RAIZ, 'packages/db/migrations');
const CLAVE = 'solo-pruebas';

export type RolBd = 'app_migrator' | 'app_rw' | 'worker_rw' | 'app_ro';

export interface BaseDePrueba {
  readonly url: (rol: RolBd) => string;
  readonly detener: () => Promise<void>;
}

const silencioso = { log: () => undefined, error: () => undefined };

export const iniciarBaseDePrueba = async (): Promise<BaseDePrueba> => {
  const contenedor: StartedPostgreSqlContainer = await new PostgreSqlContainer(IMAGEN)
    .withPlatform('linux/amd64')
    .withEnvironment({
      APP_MIGRATOR_PASSWORD: CLAVE,
      APP_RW_PASSWORD: CLAVE,
      WORKER_RW_PASSWORD: CLAVE,
      APP_RO_PASSWORD: CLAVE,
    })
    .withCopyFilesToContainer([
      {
        source: path.join(RAIZ, 'infra/compose/postgres/init.sh'),
        target: '/docker-entrypoint-initdb.d/10-init.sh',
      },
    ])
    .start();

  const url = (rol: RolBd): string =>
    `postgres://${rol}:${CLAVE}@${contenedor.getHost()}:${String(contenedor.getPort())}/campo`;

  if (!(await aplicarMigraciones(url('app_migrator'), CARPETA_MIGRACIONES, silencioso))) {
    await contenedor.stop();
    throw new Error('No se pudieron aplicar las migraciones en la base de prueba');
  }
  return {
    url,
    detener: async () => {
      await contenedor.stop();
    },
  };
};
