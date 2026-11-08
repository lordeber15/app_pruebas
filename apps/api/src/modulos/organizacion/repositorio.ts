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
  'proyecto.fotos_minimas_ejecucion',
] as const;

/** Proyectos visibles: todos para Coordinación y JdP; si no, donde es miembro activo. */
export const proyectosVisibles = (db: Db, usuarioId: string, todos: boolean) => {
  let q = db.selectFrom('proyecto').select(columnasProyecto).orderBy('proyecto.nombre');
  if (!todos) {
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom('brigada as b')
          .innerJoin('miembro_brigada as m', 'm.brigada_id', 'b.id')
          .select('b.id')
          .whereRef('b.proyecto_id', '=', 'proyecto.id')
          .where('m.usuario_id', '=', usuarioId)
          .where('m.estado', '=', 'activo'),
      ),
    );
  }
  return q.execute();
};

export const buscarProyecto = (db: Db, id: string) =>
  db.selectFrom('proyecto').select(columnasProyecto).where('id', '=', id).executeTakeFirst();

export const brigadasDeProyecto = (db: Db, proyectoId: string) =>
  db
    .selectFrom('brigada')
    .select(['brigada.id', 'brigada.codigo', 'brigada.nombre', 'brigada.region', 'brigada.tipo'])
    .where('brigada.proyecto_id', '=', proyectoId)
    .orderBy('brigada.nombre')
    .execute();

export const miembrosDeBrigada = (db: Db, brigadaId: string) =>
  db
    .selectFrom('miembro_brigada as m')
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
    .where('m.brigada_id', '=', brigadaId)
    .orderBy('u.nombre')
    .execute();

/** Estaciones con sus atributos de A01 (RN-29), sin pedírselos a nadie. */
export const estacionesDeProyecto = (db: Db, proyectoId: string) =>
  db
    .selectFrom('estacion')
    .select([
      'estacion.id',
      'estacion.codigo',
      'estacion.region',
      'estacion.uv',
      'estacion.aid_aii',
      'estacion.za_ef',
      'estacion.zona_utm',
      'estacion.este',
      'estacion.norte',
      sql<number>`ST_Y(estacion.geom)`.as('lat'),
      sql<number>`ST_X(estacion.geom)`.as('lon'),
    ])
    .where('estacion.proyecto_id', '=', proyectoId)
    .orderBy('estacion.codigo')
    .execute();
