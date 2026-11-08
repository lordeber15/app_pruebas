import { estacionCambioSchema, estacionNuevaSchema } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import { verAvanceEstaciones } from './avance.ts';
import { actualizarEstacion, crearEstacion } from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

const conId = z.object({ id: z.uuid() });

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/**
 * Estaciones desde la web (RN-29, RN-28) y su avance (métodos completos / aplicables). Crear y
 * corregir: Coordinación y JdP. El avance: el alcance del seguimiento.
 */
export const rutasEstaciones: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  app.post(
    '/proyectos/:id/estaciones',
    { schema: { params: conId, body: estacionNuevaSchema } },
    async (request, reply) =>
      reply
        .status(201)
        .send(await crearEstacion(db, actor(request), request.params.id, request.body)),
  );

  app.patch(
    '/estaciones/:id',
    { schema: { params: conId, body: estacionCambioSchema } },
    async (request) => actualizarEstacion(db, actor(request), request.params.id, request.body),
  );

  app.get('/proyectos/:id/estaciones/avance', { schema: { params: conId } }, async (request) =>
    verAvanceEstaciones(db, actor(request), request.params.id),
  );

  return Promise.resolve();
};
