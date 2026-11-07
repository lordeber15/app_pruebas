import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import type { Config } from '../../config.ts';
import type { Auth } from '../../plataforma/auth.ts';
import { actorDispositivo, requiereDispositivo, resolverActor } from '../../plataforma/sesion.ts';
import * as servicio from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
  readonly config: Config;
}

/** Solicitud de hook de tusd v2 (solo los campos que se usan). */
const hookSchema = z.object({
  Type: z.string(),
  Event: z.object({
    Upload: z.object({
      ID: z.string().nullish(),
      Size: z.number().int().nonnegative().nullish(),
      SizeIsDeferred: z.boolean().optional(),
      MetaData: z.record(z.string(), z.string()).nullish(),
      Storage: z.record(z.string(), z.string()).nullish(),
    }),
    HTTPRequest: z.object({ Header: z.record(z.string(), z.array(z.string())).nullish() }),
  }),
});

const metadatosSchema = z.object({
  archivo_id: z.uuid(),
  variante: z.enum(['preview', 'original']),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const secretoValido = (recibido: string | undefined, esperado: string): boolean => {
  if (recibido === undefined) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
};

const rechazar = (estado: number, codigo: string) => ({
  RejectUpload: true,
  HTTPResponse: {
    StatusCode: estado,
    Body: JSON.stringify({ codigo }),
    Header: { 'Content-Type': 'application/json' },
  },
});

/** Las cabeceras que tusd reenvía en el cuerpo del hook, en el formato de Node. */
const aCabeceras = (h: Record<string, string[]> | null | undefined): IncomingHttpHeaders => {
  const autorizacion = Object.entries(h ?? {}).find(
    ([k]) => k.toLowerCase() === 'authorization',
  )?.[1]?.[0];
  return autorizacion === undefined ? {} : { authorization: autorizacion };
};

export const rutasArchivos: FastifyPluginAsyncZod<Opciones> = (app, { auth, db, config }) => {
  // Hooks de tusd. No se exponen por Nginx; además exigen el secreto compartido.
  app.post(
    '/internal/tus-hooks',
    {
      config: { rateLimit: false },
      schema: { querystring: z.object({ secreto: z.string().optional() }), body: hookSchema },
    },
    async (request, reply) => {
      if (!secretoValido(request.query.secreto, config.TUSD_HOOK_SECRET)) {
        return reply.status(403).send(rechazar(403, 'NO_AUTORIZADO'));
      }
      const { Type: tipo, Event: evento } = request.body;
      const meta = metadatosSchema.safeParse(evento.Upload.MetaData ?? {});

      if (tipo === 'pre-create') {
        if (!meta.success) return rechazar(400, 'METADATOS_INVALIDOS');
        if (evento.Upload.SizeIsDeferred === true) return rechazar(413, 'TAMANO_INVALIDO');
        const actor = await resolverActor(auth, db, aCabeceras(evento.HTTPRequest.Header));
        if (actor?.dispositivoId == null || actor.estadoDispositivo !== 'activo') {
          return rechazar(401, 'NO_AUTENTICADO');
        }
        const r = await servicio.autorizarSubida(
          db,
          { ...actor, dispositivoId: actor.dispositivoId },
          {
            archivoId: meta.data.archivo_id,
            variante: meta.data.variante,
            sha256: meta.data.sha256,
          },
          evento.Upload.Size ?? null,
        );
        if (!r.ok) return rechazar(r.rechazo.estado, r.rechazo.codigo);
        return {
          ChangeFileInfo: {
            ID: r.id,
            MetaData: {
              archivo_id: meta.data.archivo_id,
              variante: meta.data.variante,
              sha256: meta.data.sha256,
            },
          },
        };
      }

      if (tipo === 'post-finish') {
        const clave = evento.Upload.Storage?.['Key'];
        if (meta.success && clave !== undefined) {
          const ok = await servicio.registrarSubidaTerminada(
            db,
            meta.data.archivo_id,
            meta.data.variante,
            clave,
          );
          if (!ok)
            request.log.warn(
              { archivo_id: meta.data.archivo_id },
              'subida terminada no registrada',
            );
        }
        return {};
      }
      return {};
    },
  );

  app.post(
    '/api/v1/archivos/estado',
    {
      preHandler: requiereDispositivo(auth, db),
      schema: { body: z.object({ ids: z.array(z.uuid()).min(1).max(500) }) },
    },
    async (request) => {
      // Solo los archivos propios; los ajenos simplemente no aparecen.
      const filas = await servicio.estadoArchivos(db, actorDispositivo(request), request.body.ids);
      return { archivos: filas };
    },
  );

  return Promise.resolve();
};
