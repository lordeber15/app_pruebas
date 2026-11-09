import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './tipos.generados.ts';

export type { DB } from './tipos.generados.ts';
export type Db = Kysely<DB>;

/** Pool de conexiones para la API (rol app_rw) o el worker (rol worker_rw). */
export const crearPool = (url: string, maxConexiones = 10): pg.Pool =>
  new pg.Pool({ connectionString: url, max: maxConexiones });

/** Cliente Kysely sobre un pool existente (la API lo comparte con Better Auth). */
export const crearDb = (pool: pg.Pool): Db =>
  new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
export {
  asignarReservasSinFila,
  crearCronogramaBase,
  elegirItemParaMetodo,
  METODOS_POR_ACTIVIDAD_ESPECIAL,
  metodosDeActividadEspecial,
  reubicarReservas,
  type FilaCronogramaBase,
  type ItemParaReserva,
} from './cronograma.ts';
export {
  aplicarActividadesEspeciales,
  derivarAplicabilidad,
  geomDesdeUtm,
  sincronizarReservas,
  versionVigenteDe,
  type ResultadoMatriz,
} from './estaciones.ts';
