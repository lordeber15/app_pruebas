import type { Evento } from '@campo/core';
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

type EventoDe<T extends Evento['tipo']> = Extract<Evento, { tipo: T }>;

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
  // F-02: toda foto pertenece a una ejecución. Fichas y audios sin ejecución son de la
  // sistematización (P-14) y se guardan para reprocesarlos.
  if (p.ejecucion_id === null) return noAplicado('NO_IMPLEMENTADO');
  return archivoDeEjecucion(tx, actor, e, p.ejecucion_id);
};

/** Foto (F-02): ligada a la ejecución, la unidad, su tipo y orientación. */
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
        ejecucion_id: ejecucionId,
        unidad_id: unidadId,
        estacion_id: ej.estacion_id,
        metodo_id: ej.metodo_id,
        tipo_foto: p.tipo_foto ?? null,
        orientacion: p.orientacion ?? null,
        candidata_reporte: p.candidata_reporte ?? false,
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
    case 'archivo_capturado':
      return archivoCapturado(tx, actor, e);
    case 'jornada_iniciada':
      return jornadaIniciada(tx, actor, e);
    case 'jornada_cerrada':
      return jornadaCerrada(tx, actor, e);
    // Se guardan completos y se podrán aplicar cuando existan sus flujos: checklist e
    // incidencias del JdB, audios y fichas (P-14) y alertas registradas en campo.
    case 'checklist_respondido':
    case 'nota_voz_registrada':
    case 'ficha_registrada':
    case 'alerta_local_generada':
    case 'articulo_marcado':
      return noAplicado('NO_IMPLEMENTADO');
  }
};
