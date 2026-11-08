import type { Db } from '@campo/db';
import { sql } from 'kysely';

/**
 * Paquete de campo TOCE (RF-M01, D02 §6 «Preparación», RN-25): lo necesario para trabajar sin
 * señal en las brigadas activas del usuario. Cronograma vigente, estaciones con sus atributos de
 * A01 (RN-29), especialidades, métodos con su configuración D01, aplicabilidad estación–método
 * (RN-28) y reservas estación × método. Sin usuarios ni datos personales de terceros.
 */
export const paqueteCampo = async (db: Db, usuarioId: string) => {
  const brigadas = await db
    .selectFrom('miembro_brigada as mb')
    .innerJoin('brigada as b', 'b.id', 'mb.brigada_id')
    .innerJoin('proyecto as p', 'p.id', 'b.proyecto_id')
    .select(['b.id', 'b.proyecto_id', 'b.codigo', 'b.nombre', 'b.region', 'b.tipo', 'mb.rol'])
    .where('mb.usuario_id', '=', usuarioId)
    .where('mb.estado', '=', 'activo')
    .where('p.estado', '=', 'activo')
    .orderBy('b.nombre')
    .execute();
  const vacio = {
    generado_en: new Date().toISOString(),
    proyectos: [],
    brigadas: [],
    cronograma: [],
    estaciones: [],
    especialidades: [],
    metodos: [],
    aplicabilidad: [],
    reservas: [],
  };
  if (brigadas.length === 0) return vacio;
  const brigadaIds = brigadas.map((b) => b.id);
  const proyectoIds = [...new Set(brigadas.map((b) => b.proyecto_id))];

  const proyectos = await db
    .selectFrom('proyecto')
    .select([
      'id',
      'nombre',
      'validacion_activa',
      'subir_originales',
      'dias_bloqueo',
      // RN-04 ampliada (2026-11-08): el celular evalúa la misma foto mínima que el worker.
      'fotos_minimas_ejecucion',
    ])
    .where('id', 'in', proyectoIds)
    .execute();

  const cronograma = await db
    .selectFrom('cronograma_item as i')
    .innerJoin('cronograma_version as v', 'v.id', 'i.version_id')
    .select([
      'i.id',
      'i.brigada_id',
      sql<string>`to_char(i.fecha, 'YYYY-MM-DD')`.as('fecha'),
      'i.tipo_actividad',
      'i.estacion_id',
      'i.detalle',
      'i.estado_fila',
      'i.actividad_especial',
      'i.orden',
      'v.numero as version',
    ])
    .where('v.estado', '=', 'vigente')
    .where('i.brigada_id', 'in', brigadaIds)
    .orderBy('i.fecha')
    .orderBy('i.orden')
    .execute();

  const reservas = await db
    .selectFrom('reserva')
    .select([
      'id',
      'estacion_id',
      'metodo_id',
      'brigada_id',
      sql<string | null>`to_char(fecha_programada, 'YYYY-MM-DD')`.as('fecha_programada'),
    ])
    .where('brigada_id', 'in', brigadaIds)
    .where('metodo_id', 'is not', null)
    .execute();

  const estacionIds = [
    ...new Set([
      ...cronograma.flatMap((i) => (i.estacion_id === null ? [] : [i.estacion_id])),
      ...reservas.flatMap((r) => (r.estacion_id === null ? [] : [r.estacion_id])),
    ]),
  ];

  const estaciones =
    estacionIds.length === 0
      ? []
      : await db
          .selectFrom('estacion')
          .select([
            'id',
            'proyecto_id',
            'codigo',
            'zona_utm',
            sql<number | null>`este::float8`.as('este'),
            sql<number | null>`norte::float8`.as('norte'),
            'aid_aii',
            'uv',
            'za_ef',
            'region',
            sql<number>`ST_Y(geom)`.as('lat'),
            sql<number>`ST_X(geom)`.as('lon'),
          ])
          .where('id', 'in', estacionIds)
          .orderBy('codigo')
          .execute();

  const especialidades = await db
    .selectFrom('especialidad')
    .select(['id', 'proyecto_id', 'codigo', 'nombre', 'es_fauna', 'orden'])
    .where('proyecto_id', 'in', proyectoIds)
    .orderBy('orden')
    .execute();

  // Solo la configuración vigente (versionada; nunca se edita en sitio una usada).
  const metodos = await db
    .selectFrom('metodo as m')
    .innerJoin('configuracion_metodologica as c', 'c.id', 'm.configuracion_id')
    .select([
      'm.id',
      'c.proyecto_id',
      'm.especialidad_id',
      'm.codigo',
      'm.nombre',
      'm.clase',
      'm.orden',
      'm.config',
      'c.numero as configuracion_numero',
    ])
    .where('c.proyecto_id', 'in', proyectoIds)
    .where('c.estado', '=', 'vigente')
    .orderBy('m.orden')
    .execute();

  const aplicabilidad =
    estacionIds.length === 0
      ? []
      : await db
          .selectFrom('estacion_metodo')
          .select(['estacion_id', 'metodo_id', 'habilitado', 'condicion_pendiente', 'origen'])
          .where('estacion_id', 'in', estacionIds)
          .execute();

  return {
    generado_en: new Date().toISOString(),
    proyectos,
    brigadas: brigadas.map(({ rol, ...b }) => ({ ...b, rol })),
    cronograma,
    estaciones,
    especialidades,
    metodos,
    aplicabilidad,
    reservas,
  };
};
