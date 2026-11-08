import { crearPaqueteMapaSchema } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Firmador } from '../../plataforma/almacenamiento.ts';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import * as mapas from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
  readonly firmador: Firmador;
  readonly opciones: mapas.OpcionesMapas;
  /** Duración de las URLs firmadas (≤ 15 min). */
  readonly ttlSegundos: number;
}

const conId = z.object({ id: z.uuid() });

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/** Paquetes de mapa sin conexión (RF-M05, CA-08, V-10). */
export const rutasMapas: FastifyPluginAsyncZod<Opciones> = (
  app,
  { auth, db, firmador, opciones, ttlSegundos },
) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  app.get('/proyectos/:id/mapas', { schema: { params: conId } }, async (request) => ({
    paquetes: await mapas.listarPaquetes(db, actor(request), request.params.id),
  }));

  app.post(
    '/proyectos/:id/mapas',
    { schema: { params: conId, body: crearPaqueteMapaSchema } },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await mapas.crearPaquete(db, actor(request), opciones, request.params.id, request.body),
        ),
  );

  app.post(
    '/proyectos/:id/mapas/brigadas',
    {
      schema: {
        params: conId,
        body: z.object({ forzar: z.boolean().default(false) }).optional(),
      },
    },
    async (request) => ({
      paquetes: await mapas.generarPaquetesBrigada(
        db,
        actor(request),
        opciones,
        request.params.id,
        request.body?.forzar ?? false,
      ),
    }),
  );

  app.post('/mapas/:id/regenerar', { schema: { params: conId } }, async (request) =>
    mapas.regenerarPaquete(db, actor(request), request.params.id),
  );

  app.get('/mapas/:id/descarga', { schema: { params: conId } }, async (request) =>
    mapas.descargarPaquete(db, actor(request), firmador, ttlSegundos, request.params.id),
  );

  app.post(
    '/mapas/:id/descargado',
    { schema: { params: conId, body: z.object({ version: z.number().int().min(1) }) } },
    async (request, reply) => {
      await mapas.confirmarDescarga(db, actor(request), request.params.id, request.body.version);
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};
