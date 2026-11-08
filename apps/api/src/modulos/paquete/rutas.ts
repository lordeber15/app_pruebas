import { puedeIntentar } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutorizado } from '../../plataforma/errores.ts';
import { actorDispositivo, requiereDispositivo } from '../../plataforma/sesion.ts';
import { rolesEnBrigadas } from '../alcance/repositorio.ts';
import { paqueteCampo } from './campo.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

export const rutasPaquete: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  /**
   * Paquete de campo TOCE de las brigadas activas del usuario (RF-M01). No retiene nada: cada
   * especialista registra su propia ejecución y el esfuerzo del método es la suma (RN-19).
   */
  app.get('/paquete/campo', { preHandler: requiereDispositivo(auth, db) }, async (request) => {
    const actor = actorDispositivo(request);
    const roles = await rolesEnBrigadas(db, actor.usuarioId);
    if (![...roles.values()].some((r) => puedeIntentar(r, 'descargar_paquete'))) {
      throw noAutorizado();
    }
    return paqueteCampo(db, actor.usuarioId);
  });

  return Promise.resolve();
};
