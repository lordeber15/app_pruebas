import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereSesion } from '../../plataforma/sesion.ts';
import { verSeguimiento } from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

/** Dashboard de seguimiento (RF-W01, RN-37, RN-38, E-09). */
export const rutasSeguimiento: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  app.get(
    '/proyectos/:id/seguimiento',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ brigada: z.uuid().optional() }),
      },
    },
    async (request) => {
      if (request.actor === null) throw noAutenticado();
      return verSeguimiento(db, request.actor, request.params.id, request.query.brigada);
    },
  );

  return Promise.resolve();
};
