import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import type { Config } from '../../config.ts';
import type { Auth } from '../../plataforma/auth.ts';
import { actorDispositivo, requiereDispositivo } from '../../plataforma/sesion.ts';
import { contenidoPaquete } from './repositorio.ts';
import * as servicio from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
  readonly config: Config;
}

export const rutasPaquete: FastifyPluginAsyncZod<Opciones> = (app, { auth, db, config }) => {
  const soloDispositivo = requiereDispositivo(auth, db);

  app.get('/paquete/disponible', { preHandler: soloDispositivo }, async (request) => {
    const tareas = await servicio.disponibles(
      db,
      actorDispositivo(request),
      config.PAQUETE_MAX_TAREAS,
    );
    return {
      tareas: tareas.map((t) => ({
        id: t.id,
        titulo: t.titulo,
        tipo: t.tipo,
        origen: t.origen,
        cuaderno: { id: t.cuaderno_id, titulo: t.cuaderno_titulo },
        proyecto: { id: t.proyecto_id, nombre: t.proyecto_nombre },
      })),
    };
  });

  app.post(
    '/paquete/descargas',
    {
      preHandler: soloDispositivo,
      schema: { body: z.object({ tarea_ids: z.array(z.uuid()).min(1) }) },
    },
    async (request) => {
      const r = await servicio.descargar(
        db,
        actorDispositivo(request),
        request.body.tarea_ids,
        config.PAQUETE_MAX_TAREAS,
      );
      const contenido = await contenidoPaquete(
        db,
        r.descargadas.map((d) => d.tareaId),
      );
      const asignacionDe = new Map(r.descargadas.map((d) => [d.tareaId, d.asignacionId]));
      return {
        asignaciones: r.descargadas.map((d) => ({
          tarea_id: d.tareaId,
          asignacion_id: d.asignacionId,
        })),
        rechazadas: r.rechazadas.map((x) => ({ tarea_id: x.tareaId, motivo: x.motivo })),
        paquete: {
          ...contenido,
          tareas: contenido.tareas.map((t) => ({
            ...t,
            asignacion_id: asignacionDe.get(t.id) ?? null,
          })),
        },
      };
    },
  );

  return Promise.resolve();
};
