import type { EstadoEjecucion } from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { despuesDe, instanteCursor, pagina, type Cursor } from '../../plataforma/paginacion.ts';

/**
 * Consultas de seguimiento de ejecuciones para la web (D02 §11, E-02, E-04, E-05). Solo lectura;
 * el alcance (qué brigadas y si solo lo propio) lo resuelve el servicio.
 */
export interface FiltroEjecuciones {
  readonly brigada?: string;
  readonly estacion?: string;
  readonly estado?: EstadoEjecucion;
}

export interface Alcance {
  /** Brigadas donde el actor ve todas las ejecuciones. */
  readonly completas: readonly string[];
  /** Brigadas donde el actor solo ve las suyas (especialista). */
  readonly propias: readonly string[];
  readonly usuarioId: string;
}

/** GeoJSON como objeto (PostGIS lo devuelve como texto). */
const geojson = (columna: string) => sql<object | null>`ST_AsGeoJSON(${sql.ref(columna)})::json`;

/** Última hora del servidor en que llegó algo de la ejecución (RN-37: siempre visible). */
const ultimaRecepcion = sql<Date | null>`(
  select max(ev.hora_servidor) from app.evento ev
   where (ev.entidad_tipo = 'ejecucion' and ev.entidad_id = e.id)
      or ev.payload->>'ejecucion_id' = e.id::text
)`;

export interface Pagina {
  readonly limite: number;
  readonly cursor: Cursor | null;
}

/** Más recientes primero; desempate por id para que el cursor sea estable. */
export const listar = async (
  db: Db,
  proyectoId: string,
  alcance: Alcance,
  f: FiltroEjecuciones,
  p: Pagina,
) => {
  let q = db
    .selectFrom('ejecucion as e')
    .innerJoin('estacion as s', 's.id', 'e.estacion_id')
    .innerJoin('metodo as m', 'm.id', 'e.metodo_id')
    .innerJoin('especialidad as esp', 'esp.id', 'm.especialidad_id')
    .innerJoin('usuario as u', 'u.id', 'e.usuario_id')
    .leftJoin('brigada as b', 'b.id', 'e.brigada_id')
    .select([
      'e.id',
      'e.estado',
      'e.abierta_en',
      'e.cerrada_en',
      'e.qa_evaluado_en',
      'e.desviacion_tipo',
      'e.desviacion_explicacion',
      'e.brigada_id',
      'e.estacion_id',
      's.codigo as estacion_codigo',
      'm.nombre as metodo_nombre',
      'esp.nombre as especialidad_nombre',
      'u.nombre as usuario_nombre',
      'b.nombre as brigada_nombre',
      sql<number>`(select count(*)::int from app.unidad un where un.ejecucion_id = e.id)`.as(
        'unidades',
      ),
      sql<number | null>`(e.resultado_qa->>'incumplimientos_obligatorios')::int`.as(
        'incumplimientos_obligatorios',
      ),
      sql<number | null>`(e.resultado_qa->>'advertencias')::int`.as('advertencias'),
      ultimaRecepcion.as('ultima_recepcion'),
      instanteCursor('e.abierta_en').as('_cursor_t'),
    ])
    .where('e.proyecto_id', '=', proyectoId)
    .where((eb) => {
      const ramas = [];
      if (alcance.completas.length > 0) ramas.push(eb('e.brigada_id', 'in', alcance.completas));
      if (alcance.propias.length > 0) {
        ramas.push(
          eb.and([
            eb('e.brigada_id', 'in', alcance.propias),
            eb('e.usuario_id', '=', alcance.usuarioId),
          ]),
        );
      }
      return ramas.length === 0 ? sql<boolean>`false` : eb.or(ramas);
    });
  if (f.brigada !== undefined) q = q.where('e.brigada_id', '=', f.brigada);
  if (f.estacion !== undefined) q = q.where('e.estacion_id', '=', f.estacion);
  if (f.estado !== undefined) q = q.where('e.estado', '=', f.estado);
  if (p.cursor !== null) q = q.where(despuesDe('e.abierta_en', 'e.id', p.cursor, 'desc'));
  const filas = await q
    .orderBy('e.abierta_en', 'desc')
    .orderBy('e.id', 'desc')
    .limit(p.limite + 1)
    .execute();
  return pagina(filas, p.limite);
};

export const cabecera = (db: Db, ejecucionId: string) =>
  db
    .selectFrom('ejecucion as e')
    .innerJoin('estacion as s', 's.id', 'e.estacion_id')
    .innerJoin('metodo as m', 'm.id', 'e.metodo_id')
    .innerJoin('especialidad as esp', 'esp.id', 'm.especialidad_id')
    .innerJoin('usuario as u', 'u.id', 'e.usuario_id')
    .leftJoin('brigada as b', 'b.id', 'e.brigada_id')
    .select([
      'e.id',
      'e.proyecto_id',
      'e.brigada_id',
      'e.usuario_id',
      'e.estado',
      'e.abierta_en',
      'e.cerrada_en',
      'e.qa_evaluado_en',
      'e.desviacion_tipo',
      'e.desviacion_explicacion',
      'e.datos',
      'e.objetivo_campo',
      'e.resultado_qa',
      'e.esfuerzo_ejecutado',
      'm.config as metodo_config',
      's.region as estacion_region',
      's.uv as estacion_uv',
      'e.estacion_id',
      's.codigo as estacion_codigo',
      's.za_ef as estacion_za_ef',
      sql<number>`ST_Y(s.geom)`.as('estacion_lat'),
      sql<number>`ST_X(s.geom)`.as('estacion_lon'),
      'm.codigo as metodo_codigo',
      'm.nombre as metodo_nombre',
      'esp.nombre as especialidad_nombre',
      'u.nombre as usuario_nombre',
      'b.nombre as brigada_nombre',
      ultimaRecepcion.as('ultima_recepcion'),
    ])
    .where('e.id', '=', ejecucionId)
    .executeTakeFirst();

export const unidades = (db: Db, ejecucionId: string) =>
  db
    .selectFrom('unidad')
    .select([
      'id',
      'codigo',
      'tipo_unidad',
      'estado',
      'orden',
      'inicio',
      'fin',
      'datos',
      'registros',
      'unidad_vinculada_id',
      geojson('geom').as('geometria'),
    ])
    .where('ejecucion_id', '=', ejecucionId)
    .orderBy('orden')
    .orderBy('codigo')
    .execute();

export const tracks = (db: Db, ejecucionId: string) =>
  db
    .selectFrom('track')
    .select([
      'id',
      'unidad_id',
      'inicio',
      'fin',
      sql<number>`jsonb_array_length(puntos)`.as('puntos'),
      geojson('geom').as('geometria'),
    ])
    .where('ejecucion_id', '=', ejecucionId)
    .orderBy('inicio')
    .execute();

export const fotos = (db: Db, ejecucionId: string) =>
  db
    .selectFrom('archivo')
    .select([
      'id',
      'unidad_id',
      'tipo_foto',
      'orientacion',
      'estado',
      'capturado_en',
      'candidata_reporte',
    ])
    .where('ejecucion_id', '=', ejecucionId)
    .where('tipo', '=', 'foto')
    .orderBy('capturado_en')
    .execute();
