import type { Db } from '@campo/db';
import { sql } from 'kysely';

export const contarProyectosActivos = async (db: Db): Promise<number> => {
  const r = await db
    .selectFrom('proyecto')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('estado', '=', 'activo')
    .executeTakeFirstOrThrow();
  return Number(r.n);
};

export const columnasProyecto = [
  'proyecto.id',
  'proyecto.nombre',
  'proyecto.estado',
  'proyecto.validacion_activa',
  'proyecto.subir_originales',
  'proyecto.dias_bloqueo',
  'proyecto.hora_cierre_jornada',
] as const;

/** Proyectos visibles: todos para el supervisor; si no, donde es jefe o miembro activo. */
export const proyectosVisibles = (db: Db, usuarioId: string, esSupervisor: boolean) => {
  let q = db.selectFrom('proyecto').select(columnasProyecto).orderBy('proyecto.nombre');
  if (!esSupervisor) {
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom('cuadrilla as c')
          .leftJoin('miembro_cuadrilla as m', 'm.cuadrilla_id', 'c.id')
          .select('c.id')
          .whereRef('c.proyecto_id', '=', 'proyecto.id')
          .where((w) =>
            w.or([
              w('c.jefe_id', '=', usuarioId),
              w.and([w('m.usuario_id', '=', usuarioId), w('m.estado', '=', 'activo')]),
            ]),
          ),
      ),
    );
  }
  return q.execute();
};

export const buscarProyecto = (db: Db, id: string) =>
  db.selectFrom('proyecto').select(columnasProyecto).where('id', '=', id).executeTakeFirst();

export const cuadrillasDeProyecto = (db: Db, proyectoId: string) =>
  db
    .selectFrom('cuadrilla')
    .leftJoin('usuario as jefe', 'jefe.id', 'cuadrilla.jefe_id')
    .select(['cuadrilla.id', 'cuadrilla.nombre', 'cuadrilla.jefe_id', 'jefe.nombre as jefe_nombre'])
    .where('cuadrilla.proyecto_id', '=', proyectoId)
    .orderBy('cuadrilla.nombre')
    .execute();

export const miembrosDeCuadrilla = (db: Db, cuadrillaId: string) =>
  db
    .selectFrom('miembro_cuadrilla as m')
    .innerJoin('usuario as u', 'u.id', 'm.usuario_id')
    .select([
      'm.id',
      'm.usuario_id',
      'm.rol',
      'm.estado',
      'u.nombre',
      'u.tipo_documento',
      'u.num_documento',
    ])
    .where('m.cuadrilla_id', '=', cuadrillaId)
    .orderBy('u.nombre')
    .execute();

export const estacionesDeProyecto = (db: Db, proyectoId: string) =>
  db
    .selectFrom('estacion')
    .select([
      'estacion.id',
      'estacion.codigo',
      sql<number>`ST_Y(estacion.geom)`.as('lat'),
      sql<number>`ST_X(estacion.geom)`.as('lon'),
      sql<
        { id: string; metodologia_id: string; nombre: string; meta_esfuerzo: string | null }[]
      >`coalesce((select json_agg(json_build_object('id', em.id, 'metodologia_id', em.metodologia_id,
          'nombre', cm.nombre, 'meta_esfuerzo', em.meta_esfuerzo) order by cm.nombre)
          from app.estacion_metodologia em join app.catalogo_metodologia cm on cm.id = em.metodologia_id
          where em.estacion_id = estacion.id), '[]'::json)`.as('metodologias'),
    ])
    .where('estacion.proyecto_id', '=', proyectoId)
    .orderBy('estacion.codigo')
    .execute();
