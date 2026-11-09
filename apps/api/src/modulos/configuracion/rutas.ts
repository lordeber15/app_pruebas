import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado, ProblemaHttp } from '../../plataforma/errores.ts';
import { leerMultipart, nombreSeguro } from '../../plataforma/multipart.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
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
 * JdP. El archivo llega como `multipart/form-data` (campo `archivo`) y se lee completo en memoria,
 * con un límite de 5 MB más el margen de las cabeceras multipart.
 */
export const rutasConfiguracion: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));
  // Solo en este plugin: el resto de la API no acepta multipart.
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: TAMANO_MAXIMO + 64 * 1024 },
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
    { schema: { params: conId }, bodyLimit: TAMANO_MAXIMO + 64 * 1024 },
    async (request, reply) => {
      const a = actor(request);
      const tipo = request.headers['content-type'] ?? '';
      if (!/^multipart\/form-data/i.test(tipo) || !Buffer.isBuffer(request.body)) {
        throw new ProblemaHttp(
          415,
          'TIPO_NO_ADMITIDO',
          'Envíe el archivo como multipart/form-data en el campo «archivo».',
        );
      }
      const parte = leerMultipart(request.body, tipo).find((p) => p.campo === 'archivo');
      if (parte === undefined) {
        throw new ProblemaHttp(400, 'ARCHIVO_VACIO', 'Adjunte el archivo de la plantilla D01.');
      }
      const vista = await previsualizarImportacionD01(db, a, request.params.id, {
        nombre: nombreSeguro(parte.nombreArchivo, 'plantilla-d01.xlsx'),
        datos: parte.datos,
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
