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
  /** Secreto compartido con tusd para sus hooks (doc. 03 §6). */
  TUSD_HOOK_SECRET: z.string().min(32, 'TUSD_HOOK_SECRET debe tener al menos 32 caracteres'),
  /** Object Storage: endpoint interno (API → S3) y público (el navegador abre las URLs firmadas). */
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET_ARCHIVOS: z.string().min(1),
  S3_ACCESS_KEY_APP: z.string().min(1),
  S3_SECRET_KEY_APP: z.string().min(1),
  /** Duración de las URLs firmadas: máximo 15 minutos (CLAUDE.md, Seguridad). */
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(900),
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
