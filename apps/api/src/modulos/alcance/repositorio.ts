import { esRolBrigada, type RolBrigada } from '@campo/core';
import type { Db } from '@campo/db';

/**
 * Consultas de alcance compartidas por los módulos. La autorización por rol viene de la matriz
 * de core; aquí se resuelve el alcance concreto (brigada, propiedad) contra la base de datos.
 */

/** Roles activos del usuario en cada una de sus brigadas. */
export const rolesEnBrigadas = async (
  db: Db,
  usuarioId: string,
): Promise<ReadonlyMap<string, RolBrigada>> => {
  const filas = await db
    .selectFrom('miembro_brigada')
    .select(['brigada_id', 'rol'])
    .where('usuario_id', '=', usuarioId)
    .where('estado', '=', 'activo')
    .execute();
  const mapa = new Map<string, RolBrigada>();
  for (const f of filas) if (esRolBrigada(f.rol)) mapa.set(f.brigada_id, f.rol);
  return mapa;
};
