import { asignarPoligonoSchema } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado, ProblemaHttp } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import { nombreArchivoDeCabecera } from '../../plataforma/xlsx.ts';
import {
  asignarPoligono,
  cargarKmz,
  estacionesConPoligono,
  listarCapas,
  listarPoligonos,
  previsualizarKmz,
  TAMANO_MAXIMO_KMZ,
} from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

const conId = z.object({ id: z.uuid() });
const TIPOS_KMZ = [
  'application/vnd.google-earth.kmz',
  'application/vnd.google-earth.kml+xml',
  'application/octet-stream',
];

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

const cuerpo = (request: FastifyRequest): Buffer => {
  if (!Buffer.isBuffer(request.body)) {
    throw new ProblemaHttp(
      415,
      'TIPO_NO_ADMITIDO',
      'Envíe el archivo .kmz o .kml como cuerpo de la solicitud (Content-Type: application/octet-stream).',
    );
  }
  return request.body;
};

/**
 * Capas y polígonos del proyecto por KMZ (decisión del usuario, 2026-11-09). El archivo llega
 * como cuerpo crudo (≤ 20 MB) y se valida por contenido en `leerKmz`.
 */
export const rutasCartografia: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));
  app.addContentTypeParser(
    TIPOS_KMZ,
    { parseAs: 'buffer', bodyLimit: TAMANO_MAXIMO_KMZ },
    (_request, b, hecho) => {
      hecho(null, b);
    },
  );

  app.post(
    '/proyectos/:id/capas/vista-previa',
    { schema: { params: conId }, bodyLimit: TAMANO_MAXIMO_KMZ },
    async (request) => previsualizarKmz(db, actor(request), request.params.id, cuerpo(request)),
  );

  app.post(
    '/proyectos/:id/capas',
    {
      schema: {
        params: conId,
        headers: z.object({
          'x-nombre-archivo': z.string().max(1_000).optional(),
          'x-nombre-capa': z.string().max(1_000).optional(),
        }),
        querystring: z.object({ asignar: z.enum(['dentro', 'no']).default('no') }),
      },
      bodyLimit: TAMANO_MAXIMO_KMZ,
    },
    async (request, reply) => {
      const r = await cargarKmz(
        db,
        actor(request),
        request.params.id,
        {
          nombre: nombreArchivoDeCabecera(request.headers['x-nombre-archivo']) ?? 'capa.kmz',
          datos: cuerpo(request),
        },
        {
          nombre: nombreArchivoDeCabecera(request.headers['x-nombre-capa']),
          asignarDentro: request.query.asignar === 'dentro',
        },
      );
      return reply.status(201).send(r);
    },
  );

  app.get('/proyectos/:id/capas', { schema: { params: conId } }, async (request) =>
    listarCapas(db, actor(request), request.params.id),
  );

  app.get('/proyectos/:id/poligonos', { schema: { params: conId } }, async (request) =>
    listarPoligonos(db, actor(request), request.params.id),
  );

  app.get('/proyectos/:id/estaciones/poligonos', { schema: { params: conId } }, async (request) =>
    estacionesConPoligono(db, actor(request), request.params.id),
  );

  app.post(
    '/proyectos/:id/estaciones/poligono',
    { schema: { params: conId, body: asignarPoligonoSchema } },
    async (request) => asignarPoligono(db, actor(request), request.params.id, request.body),
  );

  return Promise.resolve();
};
