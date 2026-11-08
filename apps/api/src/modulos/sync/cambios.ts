import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import type { ActorDispositivo } from '../../plataforma/sesion.ts';

/**
 * Bajada incremental (doc. 03 §9.4): estado de los archivos propios y orden de baja. La
 * configuración, el cronograma vigente y las reservas llegan con el paquete de campo. El cursor es opaco para el celular: codifica la hora del
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
  readonly entidad: 'dispositivo' | 'archivo';
  readonly id: string;
  readonly operacion: 'estado' | 'baja';
  readonly datos: Record<string, unknown>;
}

export const cambiosDesde = async (
  db: Db,
  actor: ActorDispositivo,
  cursor: string | undefined,
): Promise<{ cambios: Cambio[]; cursor: string }> => {
  const { rows } = await sql<{ ahora: Date }>`select now() as ahora`.execute(db);
  const ahora = rows[0]?.ahora ?? new Date();
  const desde = new Date(leerCursor(cursor).getTime() - MARGEN_MS);
  const cambios: Cambio[] = [];

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
