import type { Db } from '@campo/db';
import type { Auth } from '../../plataforma/auth.ts';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import { firmaValida, leerLlavePublica, mensajeRenovacion } from './firma.ts';
import * as repo from './repositorio.ts';

/** Tolerancia del reloj del celular para el momento firmado. */
const TOLERANCIA_MS = 5 * 60 * 1000;

export interface Activacion {
  readonly plataforma: 'android' | 'ios';
  readonly llavePublica: string;
  readonly versionApp: string;
  readonly tokenPush: string | null;
}

/**
 * Activación (doc. 02 §6.1): registra el dispositivo con su llave pública y vincula a él la
 * sesión con la que el usuario acaba de entrar.
 */
export const activar = async (
  db: Db,
  actor: Actor,
  a: Activacion,
): Promise<{ dispositivoId: string }> => {
  if (actor.dispositivoId !== null) {
    throw new ProblemaHttp(
      409,
      'SESION_YA_VINCULADA',
      'Esta sesión ya pertenece a un dispositivo.',
    );
  }
  if (leerLlavePublica(a.llavePublica) === null) {
    throw new ProblemaHttp(
      400,
      'LLAVE_INVALIDA',
      'La llave pública no es ECDSA P-256 en formato SPKI.',
    );
  }
  const dispositivoId = generarId();
  await db.transaction().execute(async (tx) => {
    await repo.insertarDispositivo(tx, { id: dispositivoId, usuarioId: actor.usuarioId, ...a });
    if (!(await repo.vincularSesion(tx, actor.sesionId, dispositivoId))) {
      throw new ProblemaHttp(
        409,
        'SESION_YA_VINCULADA',
        'Esta sesión ya pertenece a un dispositivo.',
      );
    }
  });
  return { dispositivoId };
};

export interface Renovacion {
  readonly dispositivoId: string;
  readonly momento: string;
  readonly nonce: string;
  readonly firma: string;
}

/** Todos los rechazos dan la misma respuesta: no se revela qué falló. */
const rechazo = (): ProblemaHttp =>
  new ProblemaHttp(401, 'RENOVACION_RECHAZADA', 'No se pudo renovar la sesión. Ingrese de nuevo.');

/**
 * Renovación con la llave del dispositivo (SEG-05): sin la firma de su llave privada, un token
 * copiado a otro equipo no se puede renovar. Cada nonce se acepta una sola vez.
 */
export const renovar = async (
  db: Db,
  auth: Auth,
  r: Renovacion,
  ahora: number = Date.now(),
): Promise<{ token: string; expiraEn: Date }> => {
  const momento = Date.parse(r.momento);
  if (!Number.isFinite(momento) || Math.abs(ahora - momento) > TOLERANCIA_MS) throw rechazo();

  const disp = await repo.buscarDispositivo(db, r.dispositivoId);
  if (disp?.estado !== 'activo') throw rechazo();

  const usuario = await db
    .selectFrom('usuario')
    .select('estado')
    .where('id', '=', disp.usuario_id)
    .executeTakeFirst();
  if (usuario?.estado !== 'activo') throw rechazo();

  const llave = leerLlavePublica(disp.llave_publica);
  if (
    llave === null ||
    !firmaValida(llave, mensajeRenovacion(disp.id, r.momento, r.nonce), r.firma)
  ) {
    throw rechazo();
  }
  if (!(await repo.registrarNonce(db, disp.id, r.nonce))) throw rechazo();

  const ctx = await auth.$context;
  const sesion = await ctx.internalAdapter.createSession(disp.usuario_id, false, {
    dispositivoId: disp.id,
  });
  return { token: sesion.token, expiraEn: sesion.expiresAt };
};
