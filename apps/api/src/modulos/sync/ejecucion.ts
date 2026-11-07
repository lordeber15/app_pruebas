import { esEstadoEjecucion, transicionarEjecucion, type Evento } from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import type { ActorDispositivo } from '../../plataforma/sesion.ts';
import type { Decision } from './aplicar.ts';

/**
 * Eventos de ejecución del modelo TOCE (RF-M04, RF-M11, RN-05, RN-19, RN-24, RN-30).
 *
 * Alcance: el usuario debe ser miembro activo de la brigada de la reserva estación × método; en
 * los EVENTOS (sin reserva), de alguna brigada del proyecto. Cada ejecución es de su usuario y
 * dispositivo: varios especialistas pueden ejecutar el mismo método y el esfuerzo se suma (RN-19).
 * Nada se borra: lo que no se aplica queda como evento con su motivo (RN-12).
 */
type EventoDe<T extends Evento['tipo']> = Extract<Evento, { tipo: T }>;
type Geometria = NonNullable<EventoDe<'unidad_guardada'>['payload']['geometria']>;

const noAplicado = (motivo: string): Decision => ({ estado: 'no_aplicado', motivo });
const yaAplicado = (): Decision => ({ estado: 'ya_aplicado', motivo: null });
const aplicado = (efectos: NonNullable<Decision['efectos']>): Decision => ({
  estado: 'aplicado',
  motivo: null,
  efectos,
});

/** Estados en los que el celular todavía puede modificar la ejecución. */
const EDITABLE = ['en_curso'] as const;

const brigadasDelUsuario = (tx: Db, usuarioId: string) =>
  tx
    .selectFrom('miembro_brigada as mb')
    .innerJoin('brigada as b', 'b.id', 'mb.brigada_id')
    .select(['b.id', 'b.proyecto_id'])
    .where('mb.usuario_id', '=', usuarioId)
    .where('mb.estado', '=', 'activo')
    .execute();

/** GeoJSON de la geometría capturada (RN-30): punto, línea, polígono o multipunto. */
export const geojsonDe = (g: Geometria): object | null => {
  const c = (p: { lat: number; lon: number }) => [p.lon, p.lat];
  const anillo = (v: readonly { lat: number; lon: number }[]) => {
    const primero = v[0];
    return primero === undefined ? [] : [...v.map(c), c(primero)];
  };
  switch (g.tipo) {
    case 'punto':
      return { type: 'Point', coordinates: c(g.punto) };
    case 'inicio_fin':
      return { type: 'LineString', coordinates: [c(g.inicio), c(g.fin)] };
    case 'vertices':
      return g.vertices.length >= 3
        ? { type: 'Polygon', coordinates: [anillo(g.vertices)] }
        : { type: 'MultiPoint', coordinates: g.vertices.map(c) };
    case 'parcela_forestal':
      return g.principal.length >= 3
        ? { type: 'Polygon', coordinates: [anillo(g.principal)] }
        : null;
  }
};

const geometriaSql = (g: Geometria | null) => {
  const gj = g === null ? null : geojsonDe(g);
  return gj === null
    ? null
    : sql<string>`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(gj)}), 4326)`;
};

const ejecucionPropia = (tx: Db, actor: ActorDispositivo, ejecucionId: string) =>
  tx
    .selectFrom('ejecucion')
    .select(['id', 'usuario_id', 'dispositivo_id', 'estado', 'abierta_en', 'proyecto_id'])
    .where('id', '=', ejecucionId)
    .forUpdate()
    .executeTakeFirst()
    .then((e) =>
      e === undefined ||
      e.usuario_id !== actor.usuarioId ||
      e.dispositivo_id !== actor.dispositivoId
        ? undefined
        : e,
    );

export const ejecucionAbierta = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'ejecucion_abierta'>,
): Promise<Decision> => {
  const p = e.payload;
  if (e.entidad.tipo !== 'ejecucion' || e.entidad.id !== p.ejecucion_id) {
    return noAplicado('ENTIDAD_INCONSISTENTE');
  }
  const existe = await tx
    .selectFrom('ejecucion')
    .select(['usuario_id'])
    .where('id', '=', p.ejecucion_id)
    .executeTakeFirst();
  if (existe !== undefined) {
    return existe.usuario_id === actor.usuarioId ? yaAplicado() : noAplicado('ENTIDAD_DUPLICADA');
  }

  const metodo = await tx
    .selectFrom('metodo as m')
    .innerJoin('configuracion_metodologica as c', 'c.id', 'm.configuracion_id')
    .select(['m.id', 'm.clase', 'c.proyecto_id'])
    .where('m.id', '=', p.metodo_id)
    .executeTakeFirst();
  const estacion = await tx
    .selectFrom('estacion')
    .select(['id', 'proyecto_id'])
    .where('id', '=', p.estacion_id)
    .executeTakeFirst();
  if (metodo === undefined || estacion?.proyecto_id !== metodo.proyecto_id) {
    return noAplicado('REFERENCIA_INVALIDA');
  }
  const brigadas = await brigadasDelUsuario(tx, actor.usuarioId);

  if (p.tarea_id === null) {
    // Solo los EVENTOS se registran sin reserva (D01 hoja 00, RN-40).
    if (metodo.clase !== 'evento') return noAplicado('RESERVA_REQUERIDA');
    if (!brigadas.some((b) => b.proyecto_id === metodo.proyecto_id)) {
      return noAplicado('FUERA_DE_ALCANCE');
    }
  } else {
    const tarea = await tx
      .selectFrom('tarea')
      .select(['id', 'estacion_id', 'metodo_id', 'brigada_id'])
      .where('id', '=', p.tarea_id)
      .executeTakeFirst();
    if (
      tarea === undefined ||
      tarea.estacion_id !== p.estacion_id ||
      tarea.metodo_id !== p.metodo_id
    ) {
      return noAplicado('REFERENCIA_INVALIDA');
    }
    // Mismo motivo si la brigada es otra: no se revela qué reservas existen fuera del alcance.
    if (tarea.brigada_id === null || !brigadas.some((b) => b.id === tarea.brigada_id)) {
      return noAplicado('FUERA_DE_ALCANCE');
    }
  }

  return aplicado(async (t) => {
    await t
      .insertInto('ejecucion')
      .values({
        id: p.ejecucion_id,
        proyecto_id: metodo.proyecto_id,
        tarea_id: p.tarea_id,
        estacion_id: p.estacion_id,
        metodo_id: p.metodo_id,
        usuario_id: actor.usuarioId,
        dispositivo_id: actor.dispositivoId,
        abierta_en: new Date(p.abierta_en),
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  });
};

export const unidadGuardada = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'unidad_guardada'>,
): Promise<Decision> => {
  const p = e.payload;
  if (e.entidad.tipo !== 'unidad' || e.entidad.id !== p.unidad_id) {
    return noAplicado('ENTIDAD_INCONSISTENTE');
  }
  const ej = await ejecucionPropia(tx, actor, p.ejecucion_id);
  if (ej === undefined) return noAplicado('EJECUCION_AJENA');
  const actual = await tx
    .selectFrom('unidad')
    .select(['ejecucion_id'])
    .where('id', '=', p.unidad_id)
    .executeTakeFirst();
  if (actual !== undefined && actual.ejecucion_id !== p.ejecucion_id) {
    return noAplicado('ENTIDAD_DUPLICADA');
  }
  if (p.unidad_vinculada_id !== null) {
    const vinc = await tx
      .selectFrom('unidad as u')
      .innerJoin('ejecucion as x', 'x.id', 'u.ejecucion_id')
      .select('u.id')
      .where('u.id', '=', p.unidad_vinculada_id)
      .where('x.proyecto_id', '=', ej.proyecto_id)
      .executeTakeFirst();
    // La unidad vinculada puede llegar después (otro dispositivo): se conserva para revisión.
    if (vinc === undefined) return { estado: 'en_revision', motivo: 'VINCULO_PENDIENTE' };
  }
  // RN-13: lo que llega con la ejecución ya cerrada se guarda en el historial sin reabrirla.
  if (!(EDITABLE as readonly string[]).includes(ej.estado)) {
    return { estado: 'en_revision', motivo: 'EJECUCION_CERRADA' };
  }

  const valores = {
    codigo: p.codigo,
    tipo_unidad: p.tipo_unidad,
    orden: p.orden,
    estado: p.estado,
    geom: geometriaSql(p.geometria),
    geom_detalle: p.geometria === null ? null : JSON.stringify(p.geometria),
    datos: JSON.stringify(p.datos),
    registros: JSON.stringify(p.registros),
    parametros_confirmados: JSON.stringify(p.parametros_confirmados),
    inicio: p.inicio === null ? null : new Date(p.inicio),
    fin: p.fin === null ? null : new Date(p.fin),
    unidad_vinculada_id: p.unidad_vinculada_id,
    actualizado_por: actor.usuarioId,
  };
  return aplicado(async (t) => {
    await t
      .insertInto('unidad')
      .values({
        id: p.unidad_id,
        ejecucion_id: p.ejecucion_id,
        creado_por: actor.usuarioId,
        ...valores,
      })
      .onConflict((oc) => oc.column('id').doUpdateSet(valores))
      .execute();
  });
};

export const trackRegistrado = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'track_registrado'>,
): Promise<Decision> => {
  const p = e.payload;
  if (e.entidad.tipo !== 'track' || e.entidad.id !== p.track_id) {
    return noAplicado('ENTIDAD_INCONSISTENTE');
  }
  const ej = await ejecucionPropia(tx, actor, p.ejecucion_id);
  if (ej === undefined) return noAplicado('EJECUCION_AJENA');
  const existe = await tx
    .selectFrom('track')
    .select('ejecucion_id')
    .where('id', '=', p.track_id)
    .executeTakeFirst();
  if (existe !== undefined) {
    return existe.ejecucion_id === p.ejecucion_id ? yaAplicado() : noAplicado('ENTIDAD_DUPLICADA');
  }
  if (p.unidad_id !== null) {
    const u = await tx
      .selectFrom('unidad')
      .select('id')
      .where('id', '=', p.unidad_id)
      .where('ejecucion_id', '=', p.ejecucion_id)
      .executeTakeFirst();
    if (u === undefined) return { estado: 'en_revision', motivo: 'UNIDAD_PENDIENTE' };
  }
  const linea = {
    type: 'LineString',
    coordinates: p.puntos.map((x) => [x.lon, x.lat]),
  };
  const [primero] = p.puntos;
  const ultimo = p.puntos.at(-1);
  if (primero === undefined || ultimo === undefined) return noAplicado('ESQUEMA_INVALIDO');
  // El track es evidencia: se guarda aunque la ejecución ya esté cerrada (RN-13).
  return aplicado(async (t, eventoId) => {
    await t
      .insertInto('track')
      .values({
        id: p.track_id,
        ejecucion_id: p.ejecucion_id,
        unidad_id: p.unidad_id,
        geom: sql<string>`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(linea)}), 4326)`,
        puntos: JSON.stringify(p.puntos),
        inicio: new Date(primero.hora),
        fin: new Date(ultimo.hora),
        evento_id: eventoId,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  });
};

/** RN-05: el cierre local deja la ejecución en `evidencia_pendiente` hasta verificar sus fotos. */
export const ejecucionCerrada = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'ejecucion_cerrada'>,
): Promise<Decision> => {
  const p = e.payload;
  if (e.entidad.tipo !== 'ejecucion' || e.entidad.id !== p.ejecucion_id) {
    return noAplicado('ENTIDAD_INCONSISTENTE');
  }
  const ej = await ejecucionPropia(tx, actor, p.ejecucion_id);
  if (ej === undefined) return noAplicado('EJECUCION_AJENA');
  if (!esEstadoEjecucion(ej.estado)) throw new Error('Estado de ejecución desconocido en la BD');
  if (ej.estado !== 'en_curso') return yaAplicado();
  const cierre = new Date(p.cerrada_en);
  if (cierre < ej.abierta_en) return noAplicado('CIERRE_ANTES_DE_APERTURA');
  const t = transicionarEjecucion(ej.estado, { tipo: 'cerrar' });
  if (!t.ok) return noAplicado(t.motivo);

  return aplicado(async (x) => {
    await x
      .updateTable('ejecucion')
      .set((eb) => ({
        estado: t.valor,
        cerrada_en: cierre,
        datos: JSON.stringify(p.datos),
        desviacion_tipo: p.desviacion.tipo,
        desviacion_explicacion: p.desviacion.tipo === 'ninguna' ? null : p.desviacion.explicacion,
        confirmaciones: JSON.stringify(p.confirmaciones),
        objetivo_campo: p.objetivo_campo === null ? null : String(p.objetivo_campo),
        version: eb('version', '+', 1),
        actualizado_por: actor.usuarioId,
      }))
      .where('id', '=', p.ejecucion_id)
      .execute();
  });
};

/** Contexto para una foto de una ejecución (F-02): la ejecución debe ser del usuario y dispositivo. */
export const ejecucionDeFoto = async (
  tx: Db,
  actor: ActorDispositivo,
  ejecucionId: string,
  unidadId: string | null,
) => {
  const ej = await tx
    .selectFrom('ejecucion')
    .select(['id', 'proyecto_id', 'estacion_id', 'metodo_id', 'usuario_id', 'dispositivo_id'])
    .where('id', '=', ejecucionId)
    .executeTakeFirst();
  if (
    ej === undefined ||
    ej.usuario_id !== actor.usuarioId ||
    ej.dispositivo_id !== actor.dispositivoId
  ) {
    return null;
  }
  if (unidadId !== null) {
    const u = await tx
      .selectFrom('unidad')
      .select('id')
      .where('id', '=', unidadId)
      .where('ejecucion_id', '=', ejecucionId)
      .executeTakeFirst();
    if (u === undefined) return { ...ej, unidadPendiente: true };
  }
  return { ...ej, unidadPendiente: false };
};
