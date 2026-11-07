import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import { cuadrillasVisibles, exigirEnCuadrilla, noEncontrado } from '../alcance/autorizacion.ts';

/**
 * Eventos en revisión y duplicados (RN-08, doc. 02 §6.5). El supervisor o el jefe deciden qué se
 * conserva; nada se borra: la resolución solo cambia el estado con la función controlada (SEG-14).
 *
 * ⚑ En esta versión "elegido" marca la decisión; aplicar los datos elegidos a la tarea queda para
 * la Fase 2 (sistematización y galería), cuando se definan los criterios de fusión.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const listarRevisiones = async (db: Db, actor: Actor, proyectoId: string) => {
  const mapa = await cuadrillasVisibles(db, actor, proyectoId);
  const gestionables = [...mapa]
    .filter(([, rol]) => rol === 'supervisor' || rol === 'jefe')
    .map(([id]) => id);
  if (gestionables.length === 0) return [];
  return (
    db
      .selectFrom('evento')
      // La tarea es la entidad del evento o, en archivos y evidencias, viene en el payload.
      .innerJoin('tarea', (j) =>
        j.on(
          sql<boolean>`tarea.id::text = coalesce(case when evento.entidad_tipo = 'tarea' then evento.entidad_id::text end, evento.payload->>'tarea_id')`,
        ),
      )
      .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
      .innerJoin('usuario', 'usuario.id', 'evento.usuario_id')
      .select([
        'evento.id',
        'evento.tipo',
        'evento.estado',
        'evento.motivo',
        'evento.hora_servidor',
        'evento.hora_dispositivo',
        'tarea.id as tarea_id',
        'tarea.titulo as tarea_titulo',
        'usuario.nombre as usuario_nombre',
      ])
      .where('evento.estado', 'in', ['en_revision', 'duplicado'])
      .where('tarea.proyecto_id', '=', proyectoId)
      .where('cuaderno.cuadrilla_id', 'in', gestionables)
      .orderBy('evento.hora_servidor')
      .limit(500)
      .execute()
  );
};

export const resolverRevision = async (
  db: Db,
  actor: Actor,
  eventoId: string,
  decision: 'elegido' | 'descartado',
  comentario: string | null,
) => {
  const ev = await db
    .selectFrom('evento')
    .select([
      'evento.id',
      'evento.estado',
      sql<
        string | null
      >`coalesce(case when evento.entidad_tipo = 'tarea' then evento.entidad_id::text end, evento.payload->>'tarea_id')`.as(
        'tarea_id',
      ),
    ])
    .where('evento.id', '=', eventoId)
    .executeTakeFirst();
  if (ev?.tarea_id == null || !UUID.test(ev.tarea_id)) throw noEncontrado('El evento');
  const t = await db
    .selectFrom('tarea')
    .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
    .select('cuaderno.cuadrilla_id')
    .where('tarea.id', '=', ev.tarea_id)
    .executeTakeFirst();
  if (t === undefined) throw noEncontrado('El evento');
  await exigirEnCuadrilla(db, actor, 'resolver_revisiones', t.cuadrilla_id);
  if (ev.estado !== 'en_revision' && ev.estado !== 'duplicado') {
    throw new ProblemaHttp(409, 'YA_RESUELTO', 'Este evento ya fue resuelto.');
  }
  await sql`select app.resolver_evento(${eventoId}::uuid, ${decision === 'elegido' ? 'resuelto_elegido' : 'resuelto_descartado'}, ${actor.usuarioId}::uuid, ${comentario})`.execute(
    db,
  );
};
