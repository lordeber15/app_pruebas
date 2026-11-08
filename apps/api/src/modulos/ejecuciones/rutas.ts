import { consultaPaginaSchema, ESTADOS_EJECUCION } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { decodificarCursor } from '../../plataforma/paginacion.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import { listarEjecuciones, verEjecucion } from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

const conId = z.object({ id: z.uuid() });

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/** Ejecuciones en la web (D02 §11): lista con filtros y detalle con geometrías, fotos y QA. */
export const rutasEjecuciones: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  app.get(
    '/proyectos/:id/ejecuciones',
    {
      schema: {
        params: conId,
        querystring: consultaPaginaSchema.extend({
          brigada: z.uuid().optional(),
          estacion: z.uuid().optional(),
          estado: z.enum(ESTADOS_EJECUCION).optional(),
        }),
      },
    },
    async (request) => {
      const q = request.query;
      const r = await listarEjecuciones(
        db,
        actor(request),
        request.params.id,
        {
          ...(q.brigada === undefined ? {} : { brigada: q.brigada }),
          ...(q.estacion === undefined ? {} : { estacion: q.estacion }),
          ...(q.estado === undefined ? {} : { estado: q.estado }),
        },
        { limite: q.limite, cursor: decodificarCursor(q.cursor) },
      );
      // Paginada por cursor (orden abierta_en desc, id desc): `siguiente_cursor` nulo al final.
      return { ejecuciones: r.filas, siguiente_cursor: r.siguiente_cursor };
    },
  );

  app.get('/ejecuciones/:id', { schema: { params: conId } }, async (request) =>
    verEjecucion(db, actor(request), request.params.id),
  );

  return Promise.resolve();
};
