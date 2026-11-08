import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Firmador } from '../../plataforma/almacenamiento.ts';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import * as galeria from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
  readonly firmador: Firmador;
}

const conId = z.object({ id: z.uuid() });

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/** Galería y selección manual de fotos para el reporte diario (D02 §8 y §11, E-10). */
export const rutasGaleria: FastifyPluginAsyncZod<Opciones> = (app, { auth, db, firmador }) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  const filtros = z.object({
    brigada: z.uuid().optional(),
    estacion: z.uuid().optional(),
    metodo: z.uuid().optional(),
    fecha: z.iso.date().optional(),
    seleccion: z.enum(['todas', 'candidatas', 'seleccionadas']).optional(),
  });

  app.get(
    '/proyectos/:id/galeria',
    {
      schema: {
        params: conId,
        querystring: filtros.extend({
          cursor: z.string().min(1).max(200).optional(),
          limite: z.coerce.number().int().min(1).max(galeria.LIMITE_GALERIA_MAXIMO).optional(),
        }),
      },
    },
    async (request) =>
      galeria.listarGaleria(db, firmador, actor(request), request.params.id, request.query),
  );

  // Agregado por estación para el mini mapa: mismo alcance y filtros, sin cargar las fotos.
  app.get(
    '/proyectos/:id/galeria/estaciones',
    { schema: { params: conId, querystring: filtros.omit({ estacion: true }) } },
    async (request) =>
      galeria.estacionesGaleria(db, actor(request), request.params.id, request.query),
  );

  // Cada foto de una estación en su coordenada GPS (F-02): mismo alcance y filtros, sin URLs.
  app.get(
    '/proyectos/:id/galeria/puntos',
    { schema: { params: conId, querystring: filtros.extend({ estacion: z.uuid() }) } },
    async (request) => galeria.puntosGaleria(db, actor(request), request.params.id, request.query),
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
