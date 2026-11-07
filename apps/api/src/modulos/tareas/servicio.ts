import {
  esEstadoAsignacion,
  esEstadoTarea,
  transicionarAsignacion,
  transicionarTarea,
  validacionEfectiva,
  type AccionTarea,
  type EstadoTarea,
  type OrigenTarea,
} from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import { exigirEnBrigada, noEncontrado, rolEnBrigada } from '../alcance/autorizacion.ts';
import { punto } from '../sync/repositorio.ts';

/**
 * Cuadernos y tareas desde la web (doc. 03 §8). Toda transición pasa por la máquina de estados
 * de core y queda como evento web (sin dispositivo) para el historial (RN-09, RN-11, RN-12).
 */

const conflicto = (motivo: string): ProblemaHttp => {
  const textos: Readonly<Record<string, string>> = {
    TAREA_RETENIDA:
      'La tarea está descargada en un celular: revoque la asignación antes de reasignarla.',
    MOTIVO_OBLIGATORIO: 'Indique el motivo.',
    COMENTARIO_OBLIGATORIO: 'Escriba un comentario.',
    VALIDACION_INACTIVA: 'La validación no está activa para este cuaderno.',
    SOLO_TAREA_POR_REGLA: 'Solo se cierran sin foto las tareas generadas por una regla.',
    TAREA_CERRADA: 'La tarea está cerrada.',
    TRANSICION_INVALIDA: 'La tarea no admite esta acción en su estado actual.',
  };
  return new ProblemaHttp(
    409,
    motivo,
    textos[motivo] ?? 'La acción no es válida para el estado actual.',
  );
};

/** Evento de una acción hecha en la web (dispositivo nulo; CLAUDE.md, huecos). */
const registrarEvento = (
  tx: Db,
  actor: Actor,
  tipo: string,
  tareaId: string,
  payload: Record<string, unknown>,
  estado: 'aplicado' | 'ya_aplicado' = 'aplicado',
) =>
  tx
    .insertInto('evento')
    .values({
      id: generarId(),
      tipo,
      version_esquema: 1,
      usuario_id: actor.usuarioId,
      dispositivo_id: null,
      asignacion_id: null,
      entidad_tipo: 'tarea',
      entidad_id: tareaId,
      payload: JSON.stringify(payload),
      estado,
    })
    .execute();

// ── Cuadernos ─────────────────────────────────────────────────────────────

export const crearCuaderno = async (
  db: Db,
  actor: Actor,
  d: {
    brigadaId: string;
    responsableId: string;
    titulo: string;
    validacionActiva: boolean | null;
  },
) => {
  await exigirEnBrigada(db, actor, 'gestionar_cuadernos_tareas', d.brigadaId);
  const c = await db
    .selectFrom('brigada')
    .select('proyecto_id')
    .where('id', '=', d.brigadaId)
    .executeTakeFirst();
  if (c === undefined) throw noEncontrado('La brigada');
  // RN-01: el responsable es un miembro activo de la brigada.
  const miembro = await db
    .selectFrom('miembro_brigada')
    .select('id')
    .where('brigada_id', '=', d.brigadaId)
    .where('usuario_id', '=', d.responsableId)
    .where('estado', '=', 'activo')
    .executeTakeFirst();
  if (miembro === undefined) {
    throw new ProblemaHttp(
      409,
      'RESPONSABLE_NO_MIEMBRO',
      'El responsable debe ser miembro activo de la brigada.',
    );
  }
  const id = generarId();
  await db
    .insertInto('cuaderno')
    .values({
      id,
      proyecto_id: c.proyecto_id,
      brigada_id: d.brigadaId,
      responsable_id: d.responsableId,
      titulo: d.titulo,
      validacion_activa: d.validacionActiva,
      creado_por: actor.usuarioId,
      actualizado_por: actor.usuarioId,
    })
    .execute();
  return id;
};

export const listarCuadernos = async (db: Db, actor: Actor, proyectoId: string) => {
  const filas = await db
    .selectFrom('cuaderno')
    .innerJoin('usuario as r', 'r.id', 'cuaderno.responsable_id')
    .innerJoin('brigada', 'brigada.id', 'cuaderno.brigada_id')
    .select([
      'cuaderno.id',
      'cuaderno.titulo',
      'cuaderno.brigada_id',
      'brigada.nombre as brigada_nombre',
      'cuaderno.responsable_id',
      'r.nombre as responsable_nombre',
      'cuaderno.validacion_activa',
      'cuaderno.estado',
      (eb) =>
        eb
          .selectFrom('tarea')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('tarea.cuaderno_id', '=', 'cuaderno.id')
          .as('tareas'),
    ])
    .where('cuaderno.proyecto_id', '=', proyectoId)
    .orderBy('cuaderno.titulo')
    .execute();
  const visibles: typeof filas = [];
  for (const f of filas) {
    const rol = await rolEnBrigada(db, actor, f.brigada_id);
    if (
      rol === 'supervisor' ||
      rol === 'jefe' ||
      (rol !== null && f.responsable_id === actor.usuarioId)
    )
      visibles.push(f);
  }
  return visibles;
};

// ── Tareas ────────────────────────────────────────────────────────────────

export interface NuevaTarea {
  readonly cuadernoId: string;
  readonly titulo: string;
  readonly descripcion: string | null;
  readonly tipo: 'tecnica' | 'logistica';
  readonly estacionId: string | null;
  readonly metodologiaId: string | null;
  readonly ubicacion: { lat: number; lon: number } | null;
}

export const crearTarea = async (db: Db, actor: Actor, t: NuevaTarea) => {
  const cuaderno = await db
    .selectFrom('cuaderno')
    .select(['id', 'proyecto_id', 'brigada_id'])
    .where('id', '=', t.cuadernoId)
    .executeTakeFirst();
  if (cuaderno === undefined) throw noEncontrado('El cuaderno');
  await exigirEnBrigada(db, actor, 'gestionar_cuadernos_tareas', cuaderno.brigada_id);

  let geom = t.ubicacion === null ? null : punto(t.ubicacion.lon, t.ubicacion.lat);
  if (t.estacionId !== null) {
    const est = await db
      .selectFrom('estacion')
      .select('id')
      .where('id', '=', t.estacionId)
      .where('proyecto_id', '=', cuaderno.proyecto_id)
      .executeTakeFirst();
    if (est === undefined) throw noEncontrado('La estación');
    if (t.metodologiaId !== null) {
      const em = await db
        .selectFrom('estacion_metodologia')
        .select('id')
        .where('estacion_id', '=', t.estacionId)
        .where('metodologia_id', '=', t.metodologiaId)
        .executeTakeFirst();
      if (em === undefined) {
        throw new ProblemaHttp(
          409,
          'METODOLOGIA_NO_PROGRAMADA',
          'Esa metodología no está programada en la estación.',
        );
      }
    }
    // Sin ubicación propia, la tarea toma la de su estación.
    if (geom === null) {
      geom = sql<string>`(select geom from app.estacion where id = ${t.estacionId})`;
    }
  } else if (t.metodologiaId !== null) {
    throw new ProblemaHttp(
      400,
      'ESTACION_REQUERIDA',
      'Una tarea con metodología necesita estación.',
    );
  }

  // El cuaderno ya tiene responsable: la tarea nace pendiente y queda asignada (doc. 02 §7.1).
  const asignada = transicionarTarea('pendiente', { tipo: 'asignar' });
  if (!asignada.ok) throw conflicto(asignada.motivo);
  const id = generarId();
  await db
    .insertInto('tarea')
    .values({
      id,
      proyecto_id: cuaderno.proyecto_id,
      cuaderno_id: cuaderno.id,
      origen: 'manual',
      tipo: t.tipo,
      estacion_id: t.estacionId,
      metodologia_id: t.metodologiaId,
      geom,
      titulo: t.titulo,
      descripcion: t.descripcion,
      estado: asignada.valor,
      creado_por: actor.usuarioId,
      actualizado_por: actor.usuarioId,
    })
    .execute();
  return id;
};

interface TareaBloqueada {
  readonly id: string;
  readonly estado: EstadoTarea;
  readonly origen: OrigenTarea;
  readonly brigadaId: string;
  readonly proyectoId: string;
  readonly validacionActiva: boolean;
}

/** Carga y bloquea la tarea, y exige la acción en su brigada. */
const tareaConPermiso = async (
  tx: Db,
  actor: Actor,
  tareaId: string,
  accion: Parameters<typeof exigirEnBrigada>[2],
): Promise<TareaBloqueada> => {
  const t = await tx
    .selectFrom('tarea')
    .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
    .innerJoin('proyecto', 'proyecto.id', 'tarea.proyecto_id')
    .select([
      'tarea.id',
      'tarea.estado',
      'tarea.origen',
      'tarea.proyecto_id',
      'cuaderno.brigada_id',
      'cuaderno.validacion_activa as v_cuaderno',
      'proyecto.validacion_activa as v_proyecto',
    ])
    .where('tarea.id', '=', tareaId)
    .forUpdate('tarea')
    .executeTakeFirst();
  if (t === undefined) throw noEncontrado('La tarea');
  if ((await rolEnBrigada(tx, actor, t.brigada_id)) === null) throw noEncontrado('La tarea');
  await exigirEnBrigada(tx, actor, accion, t.brigada_id);
  if (!esEstadoTarea(t.estado)) throw new Error('Estado desconocido en la BD');
  return {
    id: t.id,
    estado: t.estado,
    origen: t.origen === 'regla' ? 'regla' : 'manual',
    brigadaId: t.brigada_id,
    proyectoId: t.proyecto_id,
    validacionActiva: validacionEfectiva(t.v_cuaderno, t.v_proyecto),
  };
};

const aplicar = async (
  tx: Db,
  actor: Actor,
  t: TareaBloqueada,
  accion: AccionTarea,
): Promise<EstadoTarea> => {
  const r = transicionarTarea(t.estado, accion);
  if (!r.ok) throw conflicto(r.motivo);
  await tx
    .updateTable('tarea')
    .set((eb) => ({
      estado: r.valor,
      version: eb('version', '+', 1),
      actualizado_por: actor.usuarioId,
    }))
    .where('id', '=', t.id)
    .execute();
  return r.valor;
};

/** RN-07: una tarea no descargada o devuelta pasa a un cuaderno del nuevo responsable. */
export const reasignar = async (db: Db, actor: Actor, tareaId: string, cuadernoDestinoId: string) =>
  db.transaction().execute(async (tx) => {
    const t = await tareaConPermiso(tx, actor, tareaId, 'reasignar_tarea');
    const destino = await tx
      .selectFrom('cuaderno')
      .select(['id', 'proyecto_id', 'brigada_id', 'responsable_id'])
      .where('id', '=', cuadernoDestinoId)
      .executeTakeFirst();
    if (destino?.proyecto_id !== t.proyectoId) throw noEncontrado('El cuaderno de destino');
    await exigirEnBrigada(tx, actor, 'reasignar_tarea', destino.brigada_id);
    const estado = await aplicar(tx, actor, t, { tipo: 'reasignar' });
    await tx.updateTable('tarea').set({ cuaderno_id: destino.id }).where('id', '=', t.id).execute();
    await registrarEvento(tx, actor, 'tarea_reasignada', t.id, { cuaderno_id: destino.id });
    return estado;
  });

/** RN-07: revocar la asignación retenida, con motivo y con conexión. */
export const revocar = async (db: Db, actor: Actor, tareaId: string, motivo: string) =>
  db.transaction().execute(async (tx) => {
    const t = await tareaConPermiso(tx, actor, tareaId, 'revocar_asignacion');
    const asig = await tx
      .selectFrom('asignacion')
      .select(['id', 'estado'])
      .where('tarea_id', '=', t.id)
      .where('estado', '=', 'vigente')
      .forUpdate()
      .executeTakeFirst();
    if (asig === undefined || !esEstadoAsignacion(asig.estado))
      throw conflicto('TRANSICION_INVALIDA');
    const ra = transicionarAsignacion(asig.estado, { tipo: 'revocar', motivo });
    if (!ra.ok) throw conflicto(ra.motivo);
    const estado = await aplicar(tx, actor, t, { tipo: 'revocar', motivo });
    await tx
      .updateTable('asignacion')
      .set({ estado: ra.valor, motivo_revocacion: motivo.trim(), actualizado_por: actor.usuarioId })
      .where('id', '=', asig.id)
      .execute();
    await registrarEvento(tx, actor, 'asignacion_revocada', t.id, {
      asignacion_id: asig.id,
      motivo: motivo.trim(),
    });
    return estado;
  });

/**
 * Validar u observar (RN-06). RN-11: si otra persona ya validó, esta acción queda "ya aplicada".
 * Al observar, la tarea vuelve al mismo responsable y dispositivo con una asignación nueva
 * (doc. 02 §7.2), que le llega por la bajada incremental.
 */
export const validar = async (
  db: Db,
  actor: Actor,
  tareaId: string,
  observar: boolean,
  comentario: string | null,
) =>
  db.transaction().execute(async (tx) => {
    const t = await tareaConPermiso(tx, actor, tareaId, 'validar_tareas');
    const tipoEvento = observar ? 'observacion_validacion' : 'validacion_registrada';
    const yaHecho = observar ? t.estado === 'observada' : t.estado === 'validada';
    if (yaHecho) {
      await registrarEvento(tx, actor, tipoEvento, t.id, { comentario }, 'ya_aplicado');
      return { estado: t.estado, resultado: 'ya_aplicado' as const };
    }
    const estado = await aplicar(tx, actor, t, {
      tipo: observar ? 'observar' : 'validar',
      validacionActiva: t.validacionActiva,
    });
    if (observar) {
      const ultima = await tx
        .selectFrom('asignacion')
        .select(['usuario_id', 'dispositivo_id'])
        .where('tarea_id', '=', t.id)
        .where('estado', '=', 'finalizada')
        .orderBy('finalizada_en', 'desc')
        .executeTakeFirst();
      if (ultima !== undefined) {
        await tx
          .insertInto('asignacion')
          .values({
            id: generarId(),
            tarea_id: t.id,
            usuario_id: ultima.usuario_id,
            dispositivo_id: ultima.dispositivo_id,
            descargada_en: new Date(),
            creado_por: actor.usuarioId,
            actualizado_por: actor.usuarioId,
          })
          .execute();
      }
    }
    if (comentario !== null && comentario.trim() !== '') {
      await tx
        .insertInto('comentario')
        .values({
          id: generarId(),
          tarea_id: t.id,
          autor_id: actor.usuarioId,
          texto: comentario.trim(),
          creado_por: actor.usuarioId,
          actualizado_por: actor.usuarioId,
        })
        .execute();
    }
    await registrarEvento(tx, actor, tipoEvento, t.id, { comentario });
    return { estado, resultado: 'aplicado' as const };
  });

/** Reabrir con motivo (RN-13: una tarea cerrada solo se reabre con acción explícita). */
export const reabrir = async (db: Db, actor: Actor, tareaId: string, motivo: string) =>
  db.transaction().execute(async (tx) => {
    const t = await tareaConPermiso(tx, actor, tareaId, 'reabrir_tareas');
    const estado = await aplicar(tx, actor, t, { tipo: 'reabrir', motivo });
    await registrarEvento(tx, actor, 'tarea_reabierta', t.id, { motivo: motivo.trim() });
    return estado;
  });

/** RN-04, CP-056: cierre en la web de una tarea por regla, con comentario y sin foto. */
export const cerrar = async (db: Db, actor: Actor, tareaId: string, comentario: string) =>
  db.transaction().execute(async (tx) => {
    const t = await tareaConPermiso(tx, actor, tareaId, 'validar_tareas');
    const estado = await aplicar(tx, actor, t, { tipo: 'cerrar', origen: t.origen, comentario });
    await tx
      .insertInto('comentario')
      .values({
        id: generarId(),
        tarea_id: t.id,
        autor_id: actor.usuarioId,
        texto: comentario.trim(),
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
    await registrarEvento(tx, actor, 'tarea_cerrada', t.id, { comentario: comentario.trim() });
    return estado;
  });

/** Visibilidad de una tarea para lectura y comentarios. */
const tareaVisible = async (db: Db, actor: Actor, tareaId: string) => {
  const t = await db
    .selectFrom('tarea')
    .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
    .select(['tarea.id', 'cuaderno.brigada_id', 'cuaderno.responsable_id'])
    .where('tarea.id', '=', tareaId)
    .executeTakeFirst();
  if (t === undefined) throw noEncontrado('La tarea');
  const rol = await rolEnBrigada(db, actor, t.brigada_id);
  const propia = t.responsable_id === actor.usuarioId;
  if (rol === null || ((rol === 'especialista' || rol === 'logistico') && !propia))
    throw noEncontrado('La tarea');
  return { ...t, rol };
};

export const comentar = async (db: Db, actor: Actor, tareaId: string, texto: string) => {
  await tareaVisible(db, actor, tareaId);
  const id = generarId();
  await db
    .insertInto('comentario')
    .values({
      id,
      tarea_id: tareaId,
      autor_id: actor.usuarioId,
      texto: texto.trim(),
      creado_por: actor.usuarioId,
      actualizado_por: actor.usuarioId,
    })
    .execute();
  return id;
};

export { tareaVisible };
