import type { TipoTarea } from '@campo/core';
import type { Db } from '@campo/db';

/**
 * Consultas de alcance compartidas por los módulos. La autorización por rol viene de la matriz
 * de core; aquí se resuelve el alcance concreto (brigada, propiedad) contra la base de datos.
 */

export type RolCampo = 'especialista' | 'logistico';

/** Tipo de tarea que cada rol de campo ejecuta (doc. 01 §2.3: el logístico, solo logísticas). */
export const TIPO_POR_ROL: Readonly<Record<RolCampo, TipoTarea>> = {
  especialista: 'tecnica',
  logistico: 'logistica',
};

/** Roles de campo activos del usuario, por brigada. */
export const rolesDeCampo = async (
  db: Db,
  usuarioId: string,
): Promise<ReadonlyMap<string, RolCampo>> => {
  const filas = await db
    .selectFrom('miembro_brigada')
    .select(['brigada_id', 'rol'])
    .where('usuario_id', '=', usuarioId)
    .where('estado', '=', 'activo')
    .execute();
  const mapa = new Map<string, RolCampo>();
  for (const f of filas) {
    if (f.rol === 'especialista' || f.rol === 'logistico') mapa.set(f.brigada_id, f.rol);
  }
  return mapa;
};
