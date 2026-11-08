import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import * as galeria from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

const conId = z.object({ id: z.uuid() });

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/** Galería y selección manual de fotos para el reporte diario (D02 §8 y §11, E-10). */
export const rutasGaleria: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  app.get(
    '/proyectos/:id/galeria',
    {
      schema: {
        params: conId,
        querystring: z.object({
          brigada: z.uuid().optional(),
          estacion: z.uuid().optional(),
          metodo: z.uuid().optional(),
          fecha: z.iso.date().optional(),
          seleccion: z.enum(['todas', 'candidatas', 'seleccionadas']).optional(),
        }),
      },
    },
    async (request) => galeria.listarGaleria(db, actor(request), request.params.id, request.query),
  );

  app.post(
    '/archivos/:id/candidata',
    { schema: { params: conId, body: z.object({ candidata: z.boolean() }) } },
    async (request, reply) => {
      await galeria.marcarCandidata(db, actor(request), request.params.id, request.body.candidata);
      return reply.status(204).send();
    },
  );

  app.post(
    '/archivos/:id/seleccion-reporte',
    {
      schema: {
        params: conId,
        body: z.object({ seleccionada: z.boolean(), fecha: z.iso.date().nullable().default(null) }),
      },
    },
    async (request, reply) => {
      await galeria.seleccionarParaReporte(db, actor(request), request.params.id, request.body);
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};
