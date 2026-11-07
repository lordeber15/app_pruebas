import {
  esEstadoAsignacion,
  esEstadoTarea,
  transicionarAsignacion,
  transicionarTarea,
  type EstadoTarea,
  type Evento,
} from '@campo/core';
import type { Db } from '@campo/db';
import type { ActorDispositivo } from '../../plataforma/sesion.ts';
import {
  ejecucionAbierta,
  ejecucionCerrada,
  ejecucionDeFoto,
  trackRegistrado,
  unidadGuardada,
} from './ejecucion.ts';
import * as repo from './repositorio.ts';

/**
 * Decide qué pasa con un evento ya validado por esquema, contra el estado actual (doc. 02 §6.4).
 * Nunca borra ni descarta: lo que no se aplica queda guardado con su estado y motivo (RN-12).
 * Los efectos solo se ejecutan si el evento se aplica, después de insertar la fila del evento.
 */
export type EstadoResultado =
  'aplicado' | 'ya_aplicado' | 'no_aplicado' | 'en_revision' | 'duplicado';

export interface Decision {
  readonly estado: EstadoResultado;
  readonly motivo: string | null;
  readonly efectos?: (tx: Db, eventoId: string) => Promise<void>;
}

const noAplicado = (motivo: string): Decision => ({ estado: 'no_aplicado', motivo });
const yaAplicado = (motivo: string | null = null): Decision => ({ estado: 'ya_aplicado', motivo });
const aplicado = (efectos: Decision['efectos']): Decision => ({
  estado: 'aplicado',
  motivo: null,
  ...(efectos ? { efectos } : {}),
});

/** Estados en los que la tarea ya fue completada (aunque sea con evidencia en tránsito). */
const COMPLETADA: readonly EstadoTarea[] = ['en_transito', 'completada', 'validada'];

interface ContextoTarea {
  readonly tarea: NonNullable<Awaited<ReturnType<typeof repo.tareaBloqueada>>> & {
    estado: EstadoTarea;
  };
  readonly asignacion: { id: string; estado: 'vigente' | 'finalizada' };
}

/**
 * Carga y bloquea la tarea y la asignación del evento. La asignación debe ser del usuario y del
 * dispositivo de la sesión. Si fue revocada, el evento queda en revisión, o como duplicado si
 * otro responsable ya completó la tarea (RN-08, doc. 02 §6.5).
 */
const contextoTarea = async (
  tx: Db,
  actor: ActorDispositivo,
  tareaId: string,
  asignacionId: string | null,
): Promise<ContextoTarea | Decision> => {
  const tarea = await repo.tareaBloqueada(tx, tareaId);
  if (asignacionId === null) return noAplicado('ASIGNACION_REQUERIDA');
  const asig = await repo.asignacionBloqueada(tx, asignacionId);
  if (
    tarea === undefined ||
    asig === undefined ||
    asig.tarea_id !== tarea.id ||
    asig.usuario_id !== actor.usuarioId ||
    asig.dispositivo_id !== actor.dispositivoId
  ) {
    return noAplicado('ASIGNACION_AJENA');
  }
  if (!esEstadoTarea(tarea.estado) || !esEstadoAsignacion(asig.estado)) {
    throw new Error('Estado desconocido en la base de datos');
  }
  switch (asig.estado) {
    case 'revocada':
      return COMPLETADA.includes(tarea.estado)
        ? { estado: 'duplicado', motivo: 'TAREA_COMPLETADA_POR_OTRO' }
        : { estado: 'en_revision', motivo: 'ASIGNACION_REVOCADA' };
    case 'devuelta':
      return noAplicado('ASIGNACION_DEVUELTA');
    case 'vigente':
    case 'finalizada':
      return {
        tarea: { ...tarea, estado: tarea.estado },
        asignacion: { id: asig.id, estado: asig.estado },
      };
  }
};

const esDecision = (x: ContextoTarea | Decision): x is Decision => 'estado' in x;

type EventoDe<T extends Evento['tipo']> = Extract<Evento, { tipo: T }>;

const evidenciaItem = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'evidencia_item_creado'>,
) => {
  if (e.entidad.tipo !== 'evidencia_item') return noAplicado('ENTIDAD_INCONSISTENTE');
  const ctx = await contextoTarea(tx, actor, e.payload.tarea_id, e.asignacion_id);
  if (esDecision(ctx)) return ctx;
  const existe = await tx
    .selectFrom('evidencia_item')
    .select('tarea_id')
    .where('id', '=', e.entidad.id)
    .executeTakeFirst();
  if (existe !== undefined) {
    return existe.tarea_id === ctx.tarea.id ? yaAplicado() : noAplicado('ENTIDAD_DUPLICADA');
  }
  // RN-13: sobre una tarea cerrada se agrega al historial sin reabrirla.
  const geom = e.payload.geom;
  return aplicado(async (t) => {
    await t
      .insertInto('evidencia_item')
      .values({
        id: e.entidad.id,
        tarea_id: ctx.tarea.id,
        descripcion: e.payload.descripcion,
        geom: geom === null ? null : repo.punto(geom.coordinates[0], geom.coordinates[1]),
        orden: e.payload.orden,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  });
};

const archivoCapturado = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'archivo_capturado'>,
) => {
  const p = e.payload;
  if (p.tipo === 'comprobante') return noAplicado('NO_IMPLEMENTADO');
  if (e.entidad.tipo !== 'archivo' || e.entidad.id !== p.archivo_id) {
    return noAplicado('ENTIDAD_INCONSISTENTE');
  }
  const ejecucionId = p.ejecucion_id ?? null;
  if (ejecucionId !== null) return archivoDeEjecucion(tx, actor, e, ejecucionId);
  // Archivos sin tarea ni ejecución (gastos) son de la Fase 2.
  if (p.tarea_id === null) return noAplicado('NO_IMPLEMENTADO');
  const ctx = await contextoTarea(tx, actor, p.tarea_id, e.asignacion_id);
  if (esDecision(ctx)) return ctx;

  const existe = await tx
    .selectFrom('archivo')
    .select(['usuario_id', 'tarea_id'])
    .where('id', '=', p.archivo_id)
    .executeTakeFirst();
  if (existe !== undefined) {
    return existe.usuario_id === actor.usuarioId && existe.tarea_id === ctx.tarea.id
      ? yaAplicado()
      : noAplicado('ENTIDAD_DUPLICADA');
  }
  if (p.evidencia_item_id !== null) {
    const item = await tx
      .selectFrom('evidencia_item')
      .select('id')
      .where('id', '=', p.evidencia_item_id)
      .where('tarea_id', '=', ctx.tarea.id)
      .executeTakeFirst();
    if (item === undefined) return noAplicado('REFERENCIA_INVALIDA');
  }
  if (p.categoria_id !== null) {
    const cat = await tx
      .selectFrom('categoria_foto')
      .select('id')
      .where('id', '=', p.categoria_id)
      .where('proyecto_id', '=', ctx.tarea.proyecto_id)
      .executeTakeFirst();
    if (cat === undefined) return noAplicado('REFERENCIA_INVALIDA');
  }
  const u = e.ubicacion;
  return aplicado(async (t) => {
    await t
      .insertInto('archivo')
      .values({
        id: p.archivo_id,
        proyecto_id: ctx.tarea.proyecto_id,
        usuario_id: actor.usuarioId,
        tarea_id: ctx.tarea.id,
        evidencia_item_id: p.evidencia_item_id,
        tipo: p.tipo,
        categoria_foto_id: p.categoria_id,
        hash_preview: p.hash_preview,
        hash_original: p.hash_original,
        tamano_preview: p.tamanos.preview,
        tamano_original: p.tamanos.original,
        geom: u === null ? null : repo.punto(u.lon, u.lat),
        precision_m: u?.precision_m ?? null,
        altitud_m: u?.altitud_m ?? null,
        capturado_en: new Date(p.capturado_en),
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  });
};

/** Foto del modelo TOCE (F-02): ligada a la ejecución, la unidad, su tipo y orientación. */
const archivoDeEjecucion = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'archivo_capturado'>,
  ejecucionId: string,
): Promise<Decision> => {
  const p = e.payload;
  const existe = await tx
    .selectFrom('archivo')
    .select(['usuario_id', 'ejecucion_id'])
    .where('id', '=', p.archivo_id)
    .executeTakeFirst();
  if (existe !== undefined) {
    return existe.usuario_id === actor.usuarioId && existe.ejecucion_id === ejecucionId
      ? yaAplicado()
      : noAplicado('ENTIDAD_DUPLICADA');
  }
  const ej = await ejecucionDeFoto(tx, actor, ejecucionId, p.unidad_id ?? null);
  if (ej === null) return noAplicado('EJECUCION_AJENA');
  // La unidad puede no haber llegado aún: la foto se guarda sin unidad y queda en revisión.
  const unidadId = ej.unidadPendiente ? null : (p.unidad_id ?? null);
  const u = e.ubicacion;
  const efectos: NonNullable<Decision['efectos']> = async (t) => {
    await t
      .insertInto('archivo')
      .values({
        id: p.archivo_id,
        proyecto_id: ej.proyecto_id,
        usuario_id: actor.usuarioId,
        tarea_id: null,
        ejecucion_id: ejecucionId,
        unidad_id: unidadId,
        estacion_id: ej.estacion_id,
        metodo_id: ej.metodo_id,
        tipo_foto: p.tipo_foto ?? null,
        orientacion: p.orientacion ?? null,
        candidata_reporte: p.candidata_reporte ?? false,
        evidencia_item_id: null,
        tipo: p.tipo,
        categoria_foto_id: null,
        hash_preview: p.hash_preview,
        hash_original: p.hash_original,
        tamano_preview: p.tamanos.preview,
        tamano_original: p.tamanos.original,
        geom: u === null ? null : repo.punto(u.lon, u.lat),
        precision_m: u?.precision_m ?? null,
        altitud_m: u?.altitud_m ?? null,
        capturado_en: new Date(p.capturado_en),
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  };
  return ej.unidadPendiente
    ? { estado: 'en_revision', motivo: 'UNIDAD_PENDIENTE', efectos }
    : aplicado(efectos);
};

const comentario = async (tx: Db, actor: ActorDispositivo, e: EventoDe<'comentario_creado'>) => {
  const ctx = await contextoTarea(tx, actor, e.payload.tarea_id, e.asignacion_id);
  if (esDecision(ctx)) return ctx;
  const existe = await tx
    .selectFrom('comentario')
    .select('id')
    .where('id', '=', e.entidad.id)
    .executeTakeFirst();
  if (existe !== undefined) return noAplicado('ENTIDAD_DUPLICADA');
  return aplicado(async (t, eventoId) => {
    await t
      .insertInto('comentario')
      .values({
        id: e.entidad.id,
        tarea_id: ctx.tarea.id,
        autor_id: actor.usuarioId,
        texto: e.payload.texto,
        evento_id: eventoId,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  });
};

const ESTADOS_VERIFICADOS = ['preview_verificada', 'original_verificado'];

/** RN-04 y RN-05: completar exige ≥ 1 foto anunciada; queda en tránsito hasta verificar su hash. */
const tareaCompletada = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'tarea_completada'>,
) => {
  const ctx = await contextoTarea(tx, actor, e.payload.tarea_id, e.asignacion_id);
  if (esDecision(ctx)) return ctx;
  // RN-11: completar dos veces con la misma asignación aplica solo la primera.
  if (ctx.asignacion.estado === 'finalizada') return yaAplicado();
  if (ctx.tarea.estado === 'cerrada') return noAplicado('TAREA_CERRADA');

  const fotos = await tx
    .selectFrom('archivo')
    .select(['id', 'estado'])
    .where('id', 'in', e.payload.archivo_ids)
    .where('tarea_id', '=', ctx.tarea.id)
    .where('usuario_id', '=', actor.usuarioId)
    .where('tipo', '=', 'foto')
    .execute();

  const completar = transicionarTarea(ctx.tarea.estado, {
    tipo: 'completar',
    fotosAnunciadas: fotos.length,
  });
  if (!completar.ok) return noAplicado(completar.motivo);
  const finalizar = transicionarAsignacion(ctx.asignacion.estado, { tipo: 'finalizar' });
  if (!finalizar.ok) return noAplicado(finalizar.motivo);

  // Si alguna foto ya se verificó (subió antes que el evento), pasa directo a completada.
  const verificadas = fotos.filter((f) => ESTADOS_VERIFICADOS.includes(f.estado)).length;
  const verificar = transicionarTarea(completar.valor, {
    tipo: 'verificar_evidencia',
    fotosVerificadas: verificadas,
  });
  const estadoFinal = verificar.ok ? verificar.valor : completar.valor;

  return aplicado(async (t) => {
    await t
      .updateTable('tarea')
      .set((eb) => ({
        estado: estadoFinal,
        version: eb('version', '+', 1),
        actualizado_por: actor.usuarioId,
      }))
      .where('id', '=', ctx.tarea.id)
      .execute();
    await t
      .updateTable('asignacion')
      .set({ estado: finalizar.valor, finalizada_en: new Date(), actualizado_por: actor.usuarioId })
      .where('id', '=', ctx.asignacion.id)
      .execute();
  });
};

/**
 * RN-19: cada registro de esfuerzo es una fila nueva del usuario. La metodología debe ser de una
 * tarea que el usuario tiene o tuvo asignada en este dispositivo.
 */
const esfuerzo = async (tx: Db, actor: ActorDispositivo, e: EventoDe<'esfuerzo_registrado'>) => {
  const emId = e.payload.estacion_metodologia_id;
  if (e.entidad.tipo !== 'estacion_metodologia' || e.entidad.id !== emId) {
    return noAplicado('ENTIDAD_INCONSISTENTE');
  }
  const propia = await tx
    .selectFrom('estacion_metodologia as em')
    .innerJoin('tarea as t', (j) =>
      j
        .onRef('t.estacion_id', '=', 'em.estacion_id')
        .onRef('t.metodologia_id', '=', 'em.metodologia_id'),
    )
    .innerJoin('asignacion as a', 'a.tarea_id', 't.id')
    .select('em.id')
    .where('em.id', '=', emId)
    .where('a.usuario_id', '=', actor.usuarioId)
    .where('a.dispositivo_id', '=', actor.dispositivoId)
    .where('a.estado', 'in', ['vigente', 'finalizada'])
    .executeTakeFirst();
  if (propia === undefined) return noAplicado('METODOLOGIA_AJENA');

  return aplicado(async (t, eventoId) => {
    await t
      .insertInto('registro_esfuerzo')
      .values({
        id: eventoId,
        estacion_metodologia_id: emId,
        usuario_id: actor.usuarioId,
        fase: e.payload.fase,
        cantidad: String(e.payload.cantidad),
        fecha: e.payload.fecha,
        evento_id: eventoId,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  });
};

const jornadaIniciada = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'jornada_iniciada'>,
) => {
  if (e.entidad.tipo !== 'jornada') return noAplicado('ENTIDAD_INCONSISTENTE');
  const existe = await tx
    .selectFrom('jornada')
    .select('usuario_id')
    .where('id', '=', e.entidad.id)
    .executeTakeFirst();
  if (existe !== undefined) {
    return existe.usuario_id === actor.usuarioId ? yaAplicado() : noAplicado('ENTIDAD_DUPLICADA');
  }
  return aplicado(async (t) => {
    await t
      .insertInto('jornada')
      .values({
        id: e.entidad.id,
        usuario_id: actor.usuarioId,
        abierta_en: new Date(e.hora_dispositivo),
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  });
};

const jornadaCerrada = async (tx: Db, actor: ActorDispositivo, e: EventoDe<'jornada_cerrada'>) => {
  if (e.entidad.tipo !== 'jornada') return noAplicado('ENTIDAD_INCONSISTENTE');
  const j = await tx
    .selectFrom('jornada')
    .select(['usuario_id', 'abierta_en', 'cerrada_en'])
    .where('id', '=', e.entidad.id)
    .forUpdate()
    .executeTakeFirst();
  if (j?.usuario_id !== actor.usuarioId) return noAplicado('JORNADA_INEXISTENTE');
  if (j.cerrada_en !== null) return yaAplicado();
  const cierre = new Date(e.hora_dispositivo);
  if (cierre < j.abierta_en) return noAplicado('CIERRE_ANTES_DE_APERTURA');
  return aplicado(async (t) => {
    await t
      .updateTable('jornada')
      .set({
        cerrada_en: cierre,
        cierre_automatico: e.payload.automatica ?? false,
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', e.entidad.id)
      .execute();
  });
};

export const decidir = async (tx: Db, actor: ActorDispositivo, e: Evento): Promise<Decision> => {
  switch (e.tipo) {
    case 'ejecucion_abierta':
      return ejecucionAbierta(tx, actor, e);
    case 'unidad_guardada':
      return unidadGuardada(tx, actor, e);
    case 'track_registrado':
      return trackRegistrado(tx, actor, e);
    case 'ejecucion_cerrada':
      return ejecucionCerrada(tx, actor, e);
    case 'evidencia_item_creado':
      return evidenciaItem(tx, actor, e);
    case 'archivo_capturado':
      return archivoCapturado(tx, actor, e);
    case 'comentario_creado':
      return comentario(tx, actor, e);
    case 'tarea_completada':
      return tareaCompletada(tx, actor, e);
    case 'esfuerzo_registrado':
      return esfuerzo(tx, actor, e);
    case 'jornada_iniciada':
      return jornadaIniciada(tx, actor, e);
    case 'jornada_cerrada':
      return jornadaCerrada(tx, actor, e);
    // Se guardan completos y se podrán aplicar cuando existan sus tablas y flujos:
    // transectos, observaciones, checklist, plantillas, alertas locales y validación.
    case 'checklist_respondido':
    case 'nota_voz_registrada':
    case 'ficha_registrada':
    case 'observacion_registrada':
    case 'transecto_finalizado':
    case 'validacion_registrada':
    case 'observacion_validacion':
    case 'alerta_local_generada':
    case 'articulo_marcado':
    case 'verificacion_registrada':
      return noAplicado('NO_IMPLEMENTADO');
  }
};
