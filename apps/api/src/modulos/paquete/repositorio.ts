import type { Db } from '@campo/db';
import { sql } from 'kysely';

/** Tareas asignadas al usuario como responsable de su cuaderno, en proyectos y cuadernos activos. */
export const tareasAsignadasA = (db: Db, usuarioId: string) =>
  db
    .selectFrom('tarea')
    .innerJoin('cuaderno', (j) =>
      j
        .onRef('cuaderno.id', '=', 'tarea.cuaderno_id')
        .onRef('cuaderno.proyecto_id', '=', 'tarea.proyecto_id'),
    )
    .innerJoin('proyecto', 'proyecto.id', 'tarea.proyecto_id')
    .where('cuaderno.responsable_id', '=', usuarioId)
    .where('cuaderno.estado', '=', 'activo')
    .where('proyecto.estado', '=', 'activo');

export const listarDisponibles = (db: Db, usuarioId: string, limite: number, desde?: Date) =>
  tareasAsignadasA(db, usuarioId)
    .$if(desde !== undefined, (q) => q.where('tarea.actualizado_en', '>', desde ?? new Date(0)))
    .select([
      'tarea.id',
      'tarea.titulo',
      'tarea.tipo',
      'tarea.origen',
      'tarea.cuaderno_id',
      'cuaderno.brigada_id',
      'cuaderno.titulo as cuaderno_titulo',
      'proyecto.id as proyecto_id',
      'proyecto.nombre as proyecto_nombre',
    ])
    .where('tarea.estado', '=', 'asignada')
    .orderBy('tarea.id')
    .limit(limite)
    .execute();

/** Bloquea la tarea para descargarla (evita que dos descargas compitan). */
export const tareaParaDescargar = (db: Db, usuarioId: string, tareaId: string) =>
  tareasAsignadasA(db, usuarioId)
    .select(['tarea.id', 'tarea.estado', 'tarea.tipo', 'cuaderno.brigada_id'])
    .where('tarea.id', '=', tareaId)
    .forUpdate('tarea')
    .executeTakeFirst();

export const crearAsignacion = (
  db: Db,
  a: { id: string; tareaId: string; usuarioId: string; dispositivoId: string },
) =>
  db
    .insertInto('asignacion')
    .values({
      id: a.id,
      tarea_id: a.tareaId,
      usuario_id: a.usuarioId,
      dispositivo_id: a.dispositivoId,
      descargada_en: new Date(),
      creado_por: a.usuarioId,
      actualizado_por: a.usuarioId,
    })
    .execute();

export const cambiarEstadoTarea = (db: Db, tareaId: string, estado: string, usuarioId: string) =>
  db
    .updateTable('tarea')
    .set((eb) => ({ estado, version: eb('version', '+', 1), actualizado_por: usuarioId }))
    .where('id', '=', tareaId)
    .execute();

/**
 * Contenido del paquete de las tareas indicadas (RN-25): solo tareas, estaciones, metodologías,
 * configuración del proyecto y categorías. Sin usuarios ni datos personales de terceros.
 */
export const contenidoPaquete = async (db: Db, tareaIds: readonly string[]) => {
  if (tareaIds.length === 0) {
    return { tareas: [], proyectos: [], estaciones: [], metodologias: [], categorias: [] };
  }
  const tareas = await db
    .selectFrom('tarea')
    .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
    .innerJoin('proyecto', 'proyecto.id', 'tarea.proyecto_id')
    .select([
      'tarea.id',
      'tarea.proyecto_id',
      'tarea.cuaderno_id',
      'cuaderno.titulo as cuaderno_titulo',
      'tarea.origen',
      'tarea.tipo',
      'tarea.titulo',
      'tarea.descripcion',
      'tarea.estado',
      'tarea.version',
      'tarea.estacion_id',
      'tarea.metodologia_id',
      sql`ST_AsGeoJSON(tarea.geom)::json`.as('geom'),
      sql<boolean>`coalesce(cuaderno.validacion_activa, proyecto.validacion_activa)`.as(
        'validacion_activa',
      ),
    ])
    .where('tarea.id', 'in', tareaIds)
    .execute();

  const proyectoIds = [...new Set(tareas.map((t) => t.proyecto_id))];
  const estacionIds = [
    ...new Set(tareas.flatMap((t) => (t.estacion_id === null ? [] : [t.estacion_id]))),
  ];

  const proyectos = await db
    .selectFrom('proyecto')
    .select(['id', 'nombre', 'subir_originales', 'dias_bloqueo', 'hora_cierre_jornada'])
    .where('id', 'in', proyectoIds)
    .execute();

  const estaciones =
    estacionIds.length === 0
      ? []
      : await db
          .selectFrom('estacion')
          .select(['id', 'proyecto_id', 'codigo', sql`ST_AsGeoJSON(geom)::json`.as('geom')])
          .where('id', 'in', estacionIds)
          .execute();

  const metodologias =
    estacionIds.length === 0
      ? []
      : await db
          .selectFrom('estacion_metodologia')
          .innerJoin(
            'catalogo_metodologia',
            'catalogo_metodologia.id',
            'estacion_metodologia.metodologia_id',
          )
          .select([
            'estacion_metodologia.id',
            'estacion_metodologia.estacion_id',
            'estacion_metodologia.metodologia_id',
            'estacion_metodologia.meta_esfuerzo',
            'catalogo_metodologia.nombre',
            'catalogo_metodologia.unidad',
            'catalogo_metodologia.requiere_transecto',
          ])
          .where('estacion_metodologia.estacion_id', 'in', estacionIds)
          .execute();

  const categorias = await db
    .selectFrom('categoria_foto')
    .select(['id', 'proyecto_id', 'padre_id', 'nivel', 'nombre'])
    .where('proyecto_id', 'in', proyectoIds)
    .execute();

  return { tareas, proyectos, estaciones, metodologias, categorias };
};
