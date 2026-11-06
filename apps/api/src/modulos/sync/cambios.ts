import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import type { ActorDispositivo } from '../../plataforma/sesion.ts';
import { disponibles } from '../paquete/servicio.ts';

/**
 * Bajada incremental (doc. 03 §9.4). El cursor es opaco para el celular: codifica la hora del
 * servidor al responder. Se consulta con un margen hacia atrás para no perder filas de
 * transacciones que confirmaron tarde; el celular aplica los cambios por id, así que recibir uno
 * repetido no tiene efecto.
 */
const MARGEN_MS = 30_000;
const LIMITE = 500;

export const codificarCursor = (instante: Date): string =>
  Buffer.from(JSON.stringify({ v: 1, t: instante.toISOString() }), 'utf8').toString('base64url');

export const leerCursor = (cursor: string | undefined): Date => {
  if (cursor === undefined || cursor === '') return new Date(0);
  try {
    const { v, t } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown;
      t?: unknown;
    };
    const fecha = typeof t === 'string' ? new Date(t) : new Date(Number.NaN);
    if (v !== 1 || Number.isNaN(fecha.getTime())) throw new Error('cursor');
    return fecha;
  } catch {
    throw new ProblemaHttp(400, 'CURSOR_INVALIDO', 'El cursor de cambios no es válido.');
  }
};

export interface Cambio {
  readonly entidad: 'tarea' | 'comentario' | 'dispositivo' | 'archivo';
  readonly id: string;
  readonly operacion: 'disponible' | 'revocada' | 'estado' | 'creado' | 'baja';
  readonly datos: Record<string, unknown>;
}

export const cambiosDesde = async (
  db: Db,
  actor: ActorDispositivo,
  cursor: string | undefined,
  maxTareas: number,
): Promise<{ cambios: Cambio[]; cursor: string }> => {
  const { rows } = await sql<{ ahora: Date }>`select now() as ahora`.execute(db);
  const ahora = rows[0]?.ahora ?? new Date();
  const desde = new Date(leerCursor(cursor).getTime() - MARGEN_MS);
  const cambios: Cambio[] = [];

  // Tareas nuevas asignadas: solo como "disponibles" (doc. 03 §9.4).
  const nuevas = await disponibles(db, actor, maxTareas, desde);
  for (const t of nuevas) {
    cambios.push({
      entidad: 'tarea',
      id: t.id,
      operacion: 'disponible',
      datos: {
        titulo: t.titulo,
        tipo: t.tipo,
        cuaderno_id: t.cuaderno_id,
        proyecto_id: t.proyecto_id,
      },
    });
  }

  // Revocaciones de asignaciones retenidas en este dispositivo (RN-07, doc. 02 §6.5).
  const revocadas = await db
    .selectFrom('asignacion')
    .select(['id', 'tarea_id', 'motivo_revocacion'])
    .where('usuario_id', '=', actor.usuarioId)
    .where('dispositivo_id', '=', actor.dispositivoId)
    .where('estado', '=', 'revocada')
    .where('actualizado_en', '>', desde)
    .limit(LIMITE)
    .execute();
  for (const a of revocadas) {
    cambios.push({
      entidad: 'tarea',
      id: a.tarea_id,
      operacion: 'revocada',
      datos: { asignacion_id: a.id, motivo: a.motivo_revocacion },
    });
  }

  // Cambios de estado de las tareas que este dispositivo tiene o completó (validada, observada…).
  const estados = await db
    .selectFrom('tarea')
    .innerJoin('asignacion', 'asignacion.tarea_id', 'tarea.id')
    .select(['tarea.id', 'tarea.estado', 'tarea.version'])
    .where('asignacion.usuario_id', '=', actor.usuarioId)
    .where('asignacion.dispositivo_id', '=', actor.dispositivoId)
    .where('asignacion.estado', 'in', ['vigente', 'finalizada'])
    .where('tarea.actualizado_en', '>', desde)
    .limit(LIMITE)
    .execute();
  for (const t of estados) {
    cambios.push({
      entidad: 'tarea',
      id: t.id,
      operacion: 'estado',
      datos: { estado: t.estado, version: t.version },
    });
  }

  // Comentarios de otros sobre sus tareas. Sin el nombre del autor (RN-25).
  const comentarios = await db
    .selectFrom('comentario')
    .innerJoin('asignacion', 'asignacion.tarea_id', 'comentario.tarea_id')
    .select(['comentario.id', 'comentario.tarea_id', 'comentario.texto', 'comentario.creado_en'])
    .distinct()
    .where('asignacion.usuario_id', '=', actor.usuarioId)
    .where('asignacion.dispositivo_id', '=', actor.dispositivoId)
    .where('comentario.autor_id', '!=', actor.usuarioId)
    .where('comentario.creado_en', '>', desde)
    .limit(LIMITE)
    .execute();
  for (const c of comentarios) {
    cambios.push({
      entidad: 'comentario',
      id: c.id,
      operacion: 'creado',
      datos: { tarea_id: c.tarea_id, texto: c.texto, creado_en: c.creado_en.toISOString() },
    });
  }

  // Estado de sus archivos: el celular libera cada variante cuando está verificada (RN-17).
  const archivos = await db
    .selectFrom('archivo')
    .select(['id', 'estado'])
    .where('usuario_id', '=', actor.usuarioId)
    .where('actualizado_en', '>', desde)
    .limit(LIMITE)
    .execute();
  for (const a of archivos) {
    cambios.push({
      entidad: 'archivo',
      id: a.id,
      operacion: 'estado',
      datos: { estado: a.estado },
    });
  }

  // Orden de baja (RF-M17): el celular borra el paquete y la sesión.
  if (actor.estadoDispositivo === 'baja_pendiente') {
    cambios.push({ entidad: 'dispositivo', id: actor.dispositivoId, operacion: 'baja', datos: {} });
  }

  return { cambios, cursor: codificarCursor(ahora) };
};
