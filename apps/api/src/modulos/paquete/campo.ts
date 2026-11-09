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
    // Un CONDICIONAL descartado en la web conserva su reserva, pero ya no se ejecuta (RN-28).
    .where('estado', '<>', 'descartada')
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
          .selectFrom('estacion as e')
          .leftJoin('poligono as pg', 'pg.id', 'e.poligono_id')
          .select([
            'e.id',
            'e.proyecto_id',
            'e.codigo',
            'e.zona_utm',
            sql<number | null>`e.este::float8`.as('este'),
            sql<number | null>`e.norte::float8`.as('norte'),
            'e.aid_aii',
            'e.uv',
            'e.za_ef',
            'e.region',
            sql<number>`ST_Y(e.geom)`.as('lat'),
            sql<number>`ST_X(e.geom)`.as('lon'),
            // Polígono del proyecto (KMZ) y si la estación queda dentro; null sin polígono.
            'e.poligono_id',
            sql<boolean | null>`CASE WHEN pg.id IS NULL THEN NULL ELSE ST_Covers(pg.geom, e.geom) END`.as(
              'dentro_poligono',
            ),
          ])
          .where('e.id', 'in', estacionIds)
          .orderBy('e.codigo')
          .execute();

  // Polígonos de las estaciones del paquete, simplificados a ~1 m (GeoJSON MultiPolygon).
  const poligonoIds = [
    ...new Set(estaciones.flatMap((e) => (e.poligono_id === null ? [] : [e.poligono_id]))),
  ];
  const poligonos =
    poligonoIds.length === 0
      ? []
      : (
          await db
            .selectFrom('poligono')
            .select([
              'id',
              'proyecto_id',
              'nombre',
              sql<string>`ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.00001)), 6)`.as(
                'geojson',
              ),
            ])
            .where('id', 'in', poligonoIds)
            .execute()
        ).map(({ geojson, ...p }) => ({ ...p, geometria: JSON.parse(geojson) as unknown }));

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
    poligonos,
    especialidades,
    metodos,
    aplicabilidad,
    reservas,
  };
};
