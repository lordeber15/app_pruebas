import { esEstadoTarea, puedeIntentar, transicionarTarea } from '@campo/core';
import type { Db } from '@campo/db';
import { noAutorizado, ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { ActorDispositivo } from '../../plataforma/sesion.ts';
import { rolesDeCampo, TIPO_POR_ROL } from '../alcance/repositorio.ts';
import * as repo from './repositorio.ts';

/** Tareas que el usuario puede descargar: asignadas a él y del tipo que su rol ejecuta. */
export const disponibles = async (
  db: Db,
  actor: ActorDispositivo,
  limite: number,
  desde?: Date,
) => {
  const roles = await rolesDeCampo(db, actor.usuarioId);
  const tareas = await repo.listarDisponibles(db, actor.usuarioId, limite, desde);
  return tareas.filter((t) => {
    const rol = roles.get(t.brigada_id);
    return (
      rol !== undefined && puedeIntentar(rol, 'ejecutar_tareas') && TIPO_POR_ROL[rol] === t.tipo
    );
  });
};

export type MotivoRechazoDescarga = 'NO_DISPONIBLE' | 'TAREA_RETENIDA' | 'TRANSICION_INVALIDA';

export interface ResultadoDescarga {
  readonly descargadas: readonly { tareaId: string; asignacionId: string }[];
  readonly rechazadas: readonly { tareaId: string; motivo: MotivoRechazoDescarga }[];
}

const UNICIDAD = '23505';

/**
 * Descarga (RN-03): crea una asignación vigente por tarea, que la retiene en este dispositivo.
 * Cada tarea se procesa por separado: si otra descarga ganó la carrera, esa tarea se rechaza y
 * las demás siguen (el índice único parcial garantiza RN-02).
 */
export const descargar = async (
  db: Db,
  actor: ActorDispositivo,
  tareaIds: readonly string[],
  maximo: number,
): Promise<ResultadoDescarga> => {
  if (tareaIds.length > maximo) {
    throw new ProblemaHttp(
      400,
      'DEMASIADAS_TAREAS',
      `Puede descargar hasta ${String(maximo)} tareas a la vez.`,
    );
  }
  const roles = await rolesDeCampo(db, actor.usuarioId);
  if (![...roles.values()].some((r) => puedeIntentar(r, 'ejecutar_tareas'))) throw noAutorizado();

  const descargadas: { tareaId: string; asignacionId: string }[] = [];
  const rechazadas: { tareaId: string; motivo: MotivoRechazoDescarga }[] = [];

  for (const tareaId of new Set(tareaIds)) {
    try {
      const resultado = await db.transaction().execute(async (tx) => {
        const tarea = await repo.tareaParaDescargar(tx, actor.usuarioId, tareaId);
        const rol = tarea === undefined ? undefined : roles.get(tarea.brigada_id);
        // Mismo motivo si no existe o es de otro: no se revela la existencia de tareas ajenas.
        if (tarea === undefined || rol === undefined || TIPO_POR_ROL[rol] !== tarea.tipo) {
          return { ok: false as const, motivo: 'NO_DISPONIBLE' as const };
        }
        if (!esEstadoTarea(tarea.estado)) throw new Error('Estado de tarea desconocido en la BD');
        const t = transicionarTarea(tarea.estado, { tipo: 'descargar' });
        if (!t.ok) {
          return {
            ok: false as const,
            motivo:
              tarea.estado === 'descargada'
                ? ('TAREA_RETENIDA' as const)
                : ('TRANSICION_INVALIDA' as const),
          };
        }
        const asignacionId = generarId();
        await repo.crearAsignacion(tx, {
          id: asignacionId,
          tareaId,
          usuarioId: actor.usuarioId,
          dispositivoId: actor.dispositivoId,
        });
        await repo.cambiarEstadoTarea(tx, tareaId, t.valor, actor.usuarioId);
        return { ok: true as const, asignacionId };
      });
      if (resultado.ok) descargadas.push({ tareaId, asignacionId: resultado.asignacionId });
      else rechazadas.push({ tareaId, motivo: resultado.motivo });
    } catch (e) {
      if ((e as { code?: string }).code !== UNICIDAD) throw e;
      rechazadas.push({ tareaId, motivo: 'TAREA_RETENIDA' });
    }
  }
  return { descargadas, rechazadas };
};
