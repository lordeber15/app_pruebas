import type { Db } from '@campo/db';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import type { Auth } from './auth.ts';
import { noAutenticado, ProblemaHttp } from './errores.ts';

/**
 * Quién hace la solicitud. `usuarioId` y `dispositivoId` salen siempre de la sesión, nunca del
 * cuerpo enviado (CLAUDE.md, Eventos y sincronización).
 */
export interface Actor {
  readonly usuarioId: string;
  readonly sesionId: string;
  readonly rolGlobal: 'supervisor' | 'admin' | 'ninguno';
  readonly dispositivoId: string | null;
  readonly estadoDispositivo: 'activo' | 'baja_pendiente' | 'baja' | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

const ROLES_GLOBALES = ['supervisor', 'admin', 'ninguno'] as const;
const ESTADOS_DISPOSITIVO = ['activo', 'baja_pendiente', 'baja'] as const;

const comoRolGlobal = (r: string): Actor['rolGlobal'] =>
  ROLES_GLOBALES.find((x) => x === r) ?? 'ninguno';
const comoEstadoDispositivo = (e: string | null): Actor['estadoDispositivo'] =>
  ESTADOS_DISPOSITIVO.find((x) => x === e) ?? null;

export const resolverActor = async (
  auth: Auth,
  db: Db,
  request: FastifyRequest,
): Promise<Actor | null> => {
  const sesion = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (sesion === null) return null;

  const fila = await db
    .selectFrom('usuario')
    .leftJoin('auth_session', (j) =>
      j
        .on('auth_session.id', '=', sesion.session.id)
        .onRef('auth_session.user_id', '=', 'usuario.id'),
    )
    .leftJoin('dispositivo', 'dispositivo.id', 'auth_session.dispositivo_id')
    .select([
      'usuario.estado',
      'usuario.rol_global',
      'auth_session.dispositivo_id',
      'dispositivo.estado as estado_dispositivo',
      'dispositivo.usuario_id as dueno_dispositivo',
    ])
    .where('usuario.id', '=', sesion.user.id)
    .executeTakeFirst();

  if (fila === undefined || fila.estado !== 'activo') return null;
  // Una sesión vinculada a un dispositivo de otro usuario no es válida.
  if (fila.dispositivo_id !== null && fila.dueno_dispositivo !== sesion.user.id) return null;

  return {
    usuarioId: sesion.user.id,
    sesionId: sesion.session.id,
    rolGlobal: comoRolGlobal(fila.rol_global),
    dispositivoId: fila.dispositivo_id,
    estadoDispositivo: comoEstadoDispositivo(fila.estado_dispositivo),
  };
};

/** preHandler: exige una sesión válida de un usuario activo. */
export const requiereSesion =
  (auth: Auth, db: Db) =>
  async (request: FastifyRequest): Promise<void> => {
    request.actor = await resolverActor(auth, db, request);
    if (request.actor === null) throw noAutenticado();
  };

/**
 * preHandler: exige una sesión vinculada a un dispositivo activado (rol "Disp" del doc. 03 §8).
 * Con `permitirBaja`, deja pasar un dispositivo con baja pendiente para que se entere y se borre.
 */
export const requiereDispositivo =
  (auth: Auth, db: Db, opciones: { permitirBaja?: boolean } = {}) =>
  async (request: FastifyRequest): Promise<void> => {
    await requiereSesion(auth, db)(request);
    const actor = request.actor;
    if (actor?.dispositivoId == null) {
      throw new ProblemaHttp(
        403,
        'DISPOSITIVO_REQUERIDO',
        'Active este dispositivo para continuar.',
      );
    }
    const permitido =
      actor.estadoDispositivo === 'activo' ||
      (opciones.permitirBaja === true && actor.estadoDispositivo === 'baja_pendiente');
    if (!permitido) {
      throw new ProblemaHttp(403, 'DISPOSITIVO_DADO_DE_BAJA', 'Este dispositivo fue dado de baja.');
    }
  };
