import { crearDb, type Db } from '@campo/db';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type pg from 'pg';
import type { Config } from './config.ts';
import { rutasAlertas } from './modulos/alertas/rutas.ts';
import { rutasArchivos } from './modulos/archivos/rutas.ts';
import { rutasCronograma } from './modulos/cronograma/rutas.ts';
import { rutasDispositivos } from './modulos/dispositivos/rutas.ts';
import { rutasEjecuciones } from './modulos/ejecuciones/rutas.ts';
import { rutasEstaciones } from './modulos/estaciones/rutas.ts';
import { rutasGaleria } from './modulos/galeria/rutas.ts';
import { rutasMapas } from './modulos/mapas/rutas.ts';
import { crearAlCambiarCronograma } from './modulos/mapas/servicio.ts';
import { rutasPaquete } from './modulos/paquete/rutas.ts';
import { rutasSeguimiento } from './modulos/seguimiento/rutas.ts';
import { rutasSync } from './modulos/sync/rutas.ts';
import { rutasWeb } from './modulos/web/rutas.ts';
import { crearFirmador } from './plataforma/almacenamiento.ts';
import { crearAuth, type Auth } from './plataforma/auth.ts';
import { registrarManejoDeErrores } from './plataforma/errores.ts';
import { registrarRutasAuth } from './plataforma/rutas-auth.ts';

export interface Aplicacion {
  readonly app: FastifyInstance;
  readonly db: Db;
  readonly auth: Auth;
}

/** Nunca en los logs: contraseñas, tokens, cookies ni documentos (CLAUDE.md, Seguridad). */
const REDACTAR = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'res.headers["set-auth-token"]',
];

export const crearApp = async (config: Config, pool: pg.Pool): Promise<Aplicacion> => {
  const produccion = config.NODE_ENV === 'production' || config.NODE_ENV === 'staging';
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: produccion ? 'info' : 'debug',
            redact: { paths: REDACTAR, censor: '[oculto]' },
            // Sin query string en los logs: lleva el secreto de los hooks de tusd y cursores.
            serializers: {
              req: (req: { method: string; url: string; id: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url.split('?')[0],
              }),
            },
          },
    bodyLimit: 1024 * 1024,
    trustProxy: produccion,
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('actor', null);
  registrarManejoDeErrores(app, produccion);

  await app.register(helmet);
  // SEG-09: solo el origen exacto de la web.
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  const db = crearDb(pool);
  const auth = crearAuth(pool, config);

  // Healthchecks internos: Nginx no los expone (doc. 03 §8).
  app.get('/health', () => ({ estado: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await sql`select 1`.execute(db);
      return { estado: 'listo' };
    } catch {
      return reply.status(503).send({ estado: 'sin_base_de_datos' });
    }
  });

  registrarRutasAuth(app, auth, config);
  await app.register(rutasDispositivos, { prefix: '/api/v1', auth, db });
  await app.register(rutasPaquete, { prefix: '/api/v1', auth, db });
  await app.register(rutasSync, { prefix: '/api/v1', auth, db, config });
  await app.register(rutasArchivos, { auth, db, config });
  const firmador = crearFirmador(config);
  const opcionesMapas = {
    zoomMax: config.MAPA_ZOOM_MAXIMO,
    ladoMaximoKm: config.MAPA_LADO_MAXIMO_KM,
  };
  // Tras publicar el cronograma base o aprobar un cambio: áreas de mapa de las brigadas.
  const alCambiarCronograma = crearAlCambiarCronograma(db, opcionesMapas, app.log);
  await app.register(rutasWeb, { prefix: '/api/v1', auth, db, firmador, alCambiarCronograma });
  await app.register(rutasEjecuciones, { prefix: '/api/v1', auth, db });
  await app.register(rutasAlertas, { prefix: '/api/v1', auth, db });
  await app.register(rutasCronograma, { prefix: '/api/v1', auth, db, alCambiarCronograma });
  await app.register(rutasSeguimiento, { prefix: '/api/v1', auth, db });
  await app.register(rutasEstaciones, { prefix: '/api/v1', auth, db });
  await app.register(rutasGaleria, { prefix: '/api/v1', auth, db, firmador });
  await app.register(rutasMapas, {
    prefix: '/api/v1',
    auth,
    db,
    firmador,
    opciones: opcionesMapas,
    ttlSegundos: config.S3_PRESIGN_TTL_SECONDS,
  });

  return { app, db, auth };
};
