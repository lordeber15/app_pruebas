import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado, ProblemaHttp } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import { nombreArchivoDeCabecera } from '../../plataforma/xlsx.ts';
import { TIPO_XLSX } from './excel-d01.ts';
import {
  aplicarImportacionD01,
  descargarPlantillaD01,
  previsualizarImportacionD01,
  TAMANO_MAXIMO,
  verConfiguracionD01,
  verImportacionD01,
} from './importacion-d01.ts';

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
 * Configuración por método D01 desde la web con la plantilla Excel (RF-W09). Solo Coordinación y
 * JdP. El .xlsx llega como cuerpo crudo (igual que la programación A01), con un límite de 5 MB y el
 * nombre opcional en la cabecera `x-nombre-archivo`; se valida por contenido con `validarXlsx`.
 */
export const rutasConfiguracion: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));
  // El Excel llega como cuerpo crudo (sin multipart), con su límite; solo en este plugin.
  app.addContentTypeParser(
    [TIPO_XLSX, 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: TAMANO_MAXIMO },
    (_request, cuerpo, hecho) => {
      hecho(null, cuerpo);
    },
  );

  app.get('/proyectos/:id/configuracion/d01', { schema: { params: conId } }, async (request) =>
    verConfiguracionD01(db, actor(request), request.params.id),
  );

  app.get(
    '/proyectos/:id/configuracion/d01/plantilla',
    {
      schema: {
        params: conId,
        querystring: z.object({ con_datos: z.enum(['0', '1']).default('0') }),
      },
    },
    async (request, reply) => {
      const { archivo, nombre } = await descargarPlantillaD01(
        db,
        actor(request),
        request.params.id,
        request.query.con_datos === '1',
      );
      return reply
        .header('content-type', TIPO_XLSX)
        .header('content-disposition', `attachment; filename="${nombre}"`)
        .header('cache-control', 'no-store')
        .send(archivo);
    },
  );

  app.post(
    '/proyectos/:id/configuracion/d01/importar',
    {
      schema: {
        params: conId,
        // Nombre del archivo, opcional, para el historial de la carga.
        headers: z.object({ 'x-nombre-archivo': z.string().max(1_000).optional() }),
      },
      bodyLimit: TAMANO_MAXIMO,
    },
    async (request, reply) => {
      const a = actor(request);
      if (!Buffer.isBuffer(request.body)) {
        throw new ProblemaHttp(
          415,
          'TIPO_NO_ADMITIDO',
          `Envíe el archivo .xlsx como cuerpo de la solicitud (Content-Type: ${TIPO_XLSX}).`,
        );
      }
      const vista = await previsualizarImportacionD01(db, a, request.params.id, {
        nombre:
          nombreArchivoDeCabecera(request.headers['x-nombre-archivo']) ?? 'plantilla-d01.xlsx',
        datos: request.body,
      });
      return reply.status(201).send(vista);
    },
  );

  app.get('/importaciones-d01/:id', { schema: { params: conId } }, async (request) =>
    verImportacionD01(db, actor(request), request.params.id),
  );

  app.post(
    '/importaciones-d01/:id/aplicar',
    {
      schema: {
        params: conId,
        body: z.object({ motivo: z.string().trim().min(3).max(500) }),
      },
    },
    async (request) =>
      aplicarImportacionD01(db, actor(request), request.params.id, request.body.motivo),
  );

  return Promise.resolve();
};
