import { z } from 'zod';

/** Variables de entorno de la API (doc. 03 §6). Se validan al arrancar: sin valor, no arranca. */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().startsWith('postgres'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET debe tener al menos 32 caracteres'),
  BETTER_AUTH_URL: z.url(),
  WEB_ORIGIN: z.url(),
  /** Intentos de login por cuenta cada 15 minutos (SEG-04). */
  RATE_LIMIT_LOGIN: z.coerce.number().int().positive().default(5),
  /** Intentos de login por IP por minuto. Holgado: muchos celulares comparten IP (NAT del operador). */
  RATE_LIMIT_LOGIN_IP: z.coerce.number().int().positive().default(30),
  SYNC_MAX_EVENTOS_LOTE: z.coerce.number().int().positive().default(500),
  PAQUETE_MAX_TAREAS: z.coerce.number().int().positive().default(200),
});

export type Config = z.infer<typeof esquema>;

export const leerConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const r = esquema.safeParse(env);
  if (!r.success) {
    // Solo los nombres de las variables: nunca sus valores.
    const faltan = r.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración inválida: ${faltan}`);
  }
  return r.data;
};
