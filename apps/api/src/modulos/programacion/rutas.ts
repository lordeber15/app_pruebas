import { filasProgramacionSchema } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado, ProblemaHttp } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import type { AlCambiarCronograma } from '../mapas/servicio.ts';
import { leerProgramacionXlsx } from './excel.ts';
import { validarXlsx } from '../../plataforma/xlsx.ts';
import * as programacion from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
  readonly alCambiarCronograma?: AlCambiarCronograma;
}

/** Tamaño máximo del Excel subido (A01 completo pesa ~30 KB). */
export const LIMITE_XLSX_BYTES = 5 * 1024 * 1024;

const conId = z.object({ id: z.uuid() });
const motivo = z.string().trim().min(1).max(2000);
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Nombre del archivo enviado en la cabecera (codificado como URI); solo para el historial. */
const nombreArchivo = (valor: string | undefined): string | null => {
  if (valor === undefined || valor === '') return null;
  let n: string;
  try {
    n = decodeURIComponent(valor);
  } catch {
    n = valor;
  }
  // eslint-disable-next-line no-control-regex -- se quitan caracteres de control del nombre.
  return n.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255);
};

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/**
 * Programación A01 desde la web (RF-W09): plantilla, carga con vista previa, propuesta del
 * Supervisor de campo y aplicación por Coordinación o JdP (RN-35, RN-36). La autorización por
 * rol + alcance está en el servicio.
 */
export const rutasProgramacion: FastifyPluginAsyncZod<Opciones> = (
  app,
  { auth, db, alCambiarCronograma },
) => {
  app.addHook('preHandler', requiereSesion(auth, db));
  // El Excel llega como cuerpo crudo (sin multipart), con su límite; solo en estas rutas.
  app.addContentTypeParser(
    [TIPO_XLSX, 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: LIMITE_XLSX_BYTES },
    (_request, cuerpo, listo) => {
      listo(null, cuerpo);
    },
  );

  app.get(
    '/proyectos/:id/programacion/plantilla',
    {
      schema: {
        params: conId,
        querystring: z.object({ con_datos: z.enum(['0', '1']).default('0') }),
      },
    },
    async (request, reply) => {
      const p = await programacion.descargarPlantilla(
        db,
        actor(request),
        request.params.id,
        request.query.con_datos === '1',
      );
      return reply
        .header('content-type', TIPO_XLSX)
        .header('content-disposition', `attachment; filename="${p.nombre}"`)
        .header('cache-control', 'no-store')
        .send(p.archivo);
    },
  );

  app.post(
    '/proyectos/:id/programacion/importar',
    {
      schema: {
        params: conId,
        // Nombre del archivo, opcional, para el historial de la carga.
        headers: z.object({ 'x-nombre-archivo': z.string().max(1_000).optional() }),
      },
      bodyLimit: LIMITE_XLSX_BYTES,
    },
    async (request, reply) => {
      const quien = actor(request);
      // Se autoriza antes de leer el archivo.
      await programacion.autorizarCarga(db, quien, request.params.id);
      if (!Buffer.isBuffer(request.body)) {
        throw new ProblemaHttp(
          415,
          'TIPO_NO_ADMITIDO',
          `Envíe el archivo .xlsx como cuerpo de la solicitud (Content-Type: ${TIPO_XLSX}).`,
        );
      }
      const datos = request.body;
      if (datos.length === 0) {
        throw new ProblemaHttp(400, 'ARCHIVO_VACIO', 'El archivo está vacío.');
      }
      const archivo = { nombre: nombreArchivo(request.headers['x-nombre-archivo']), datos };
      // Tipo por contenido (firma ZIP + estructura OOXML) y anti «bomba zip», nunca por la extensión.
      const libro = validarXlsx(datos);
      const filas = await leerProgramacionXlsx(libro);
      const vista = await programacion.previsualizar(db, quien, request.params.id, {
        origen: 'excel',
        filas,
        archivo,
      });
      return reply.status(201).send(vista);
    },
  );

  // Llenado en la web: las mismas filas en JSON, la misma vista previa.
  app.post(
    '/proyectos/:id/programacion/filas',
    { schema: { params: conId, body: filasProgramacionSchema }, bodyLimit: LIMITE_XLSX_BYTES },
    async (request, reply) =>
      reply.status(201).send(
        await programacion.previsualizar(db, actor(request), request.params.id, {
          origen: 'web',
          filas: request.body.filas,
        }),
      ),
  );

  app.get(
    '/proyectos/:id/programacion/importaciones',
    {
      schema: {
        params: conId,
        querystring: z.object({
          estado: z.enum(['pendiente', 'propuesta', 'aplicada', 'descartada']).optional(),
        }),
      },
    },
    async (request) =>
      programacion.listarImportaciones(db, actor(request), request.params.id, request.query.estado),
  );

  app.get('/importaciones-programacion/:id', { schema: { params: conId } }, async (request) =>
    programacion.verImportacion(db, actor(request), request.params.id),
  );

  app.post(
    '/importaciones-programacion/:id/aplicar',
    {
      schema: {
        params: conId,
        body: z.object({ motivo, aplicar_ahora: z.boolean().default(false) }),
      },
    },
    async (request) =>
      programacion.aplicarImportacion(
        db,
        actor(request),
        request.params.id,
        { motivo: request.body.motivo, aplicarAhora: request.body.aplicar_ahora },
        alCambiarCronograma,
      ),
  );

  app.post(
    '/importaciones-programacion/:id/proponer',
    { schema: { params: conId, body: z.object({ motivo }) } },
    async (request, reply) => {
      await programacion.proponerImportacion(
        db,
        actor(request),
        request.params.id,
        request.body.motivo,
      );
      return reply.status(204).send();
    },
  );

  app.post(
    '/importaciones-programacion/:id/descartar',
    { schema: { params: conId, body: z.object({ motivo }) } },
    async (request, reply) => {
      await programacion.descartarImportacion(
        db,
        actor(request),
        request.params.id,
        request.body.motivo,
      );
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};
