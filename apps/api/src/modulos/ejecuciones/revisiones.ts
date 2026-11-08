import { puedeModificar } from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import { brigadasVisibles, exigirEnBrigada, noEncontrado } from '../alcance/autorizacion.ts';

/**
 * Eventos en revisión y duplicados (RN-13, doc. 02 §6.5): lo que llegó tarde a una ejecución ya
 * cerrada, una foto cuya unidad aún no llegaba o un vínculo pendiente. Coordinación y el Jefe de
 * Proyecto deciden qué se conserva; nada se borra: la resolución solo cambia el estado con la
 * función controlada (SEG-14).
 *
 * ⚑ En esta versión «elegido» marca la decisión; aplicar los datos elegidos a la ejecución queda
 * para cuando se definan los criterios de fusión.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** La ejecución es la entidad del evento o, en unidades, tracks y fotos, viene en el payload. */
const ejecucionDelEvento = sql<
  string | null
>`coalesce(case when evento.entidad_tipo = 'ejecucion' then evento.entidad_id::text end, evento.payload->>'ejecucion_id')`;

export const listarRevisiones = async (db: Db, actor: Actor, proyectoId: string) => {
  const mapa = await brigadasVisibles(db, actor, proyectoId);
  const gestionables = [...mapa]
    .filter(([, rol]) => puedeModificar(rol, 'resolver_revisiones'))
    .map(([id]) => id);
  if (gestionables.length === 0) return [];
  return db
    .selectFrom('evento')
    .innerJoin('ejecucion', (j) => j.on(sql<boolean>`ejecucion.id::text = ${ejecucionDelEvento}`))
    .innerJoin('estacion', 'estacion.id', 'ejecucion.estacion_id')
    .innerJoin('metodo', 'metodo.id', 'ejecucion.metodo_id')
    .innerJoin('usuario', 'usuario.id', 'evento.usuario_id')
    .select([
      'evento.id',
      'evento.tipo',
      'evento.estado',
      'evento.motivo',
      'evento.hora_servidor',
      'evento.hora_dispositivo',
      'ejecucion.id as ejecucion_id',
      'estacion.codigo as estacion_codigo',
      'metodo.nombre as metodo_nombre',
      'usuario.nombre as usuario_nombre',
    ])
    .where('evento.estado', 'in', ['en_revision', 'duplicado'])
    .where('ejecucion.proyecto_id', '=', proyectoId)
    .where('ejecucion.brigada_id', 'in', gestionables)
    .orderBy('evento.hora_servidor')
    .limit(500)
    .execute();
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
    .select(['evento.id', 'evento.estado', ejecucionDelEvento.as('ejecucion_id')])
    .where('evento.id', '=', eventoId)
    .executeTakeFirst();
  if (ev?.ejecucion_id == null || !UUID.test(ev.ejecucion_id)) throw noEncontrado('El evento');
  const ej = await db
    .selectFrom('ejecucion')
    .select('brigada_id')
    .where('id', '=', ev.ejecucion_id)
    .executeTakeFirst();
  if (ej?.brigada_id == null) throw noEncontrado('El evento');
  await exigirEnBrigada(db, actor, 'resolver_revisiones', ej.brigada_id);
  if (ev.estado !== 'en_revision' && ev.estado !== 'duplicado') {
    throw new ProblemaHttp(409, 'YA_RESUELTO', 'Este evento ya fue resuelto.');
  }
  await sql`select app.resolver_evento(${eventoId}::uuid, ${decision === 'elegido' ? 'resuelto_elegido' : 'resuelto_descartado'}, ${actor.usuarioId}::uuid, ${comentario})`.execute(
    db,
  );
};
