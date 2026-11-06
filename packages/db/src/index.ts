import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './tipos.generados.ts';

export type { DB } from './tipos.generados.ts';

/** Cliente Kysely para la API (rol app_rw) o el worker (rol worker_rw). */
export const crearDb = (url: string, maxConexiones = 10): Kysely<DB> =>
  new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, max: maxConexiones }),
    }),
  });
