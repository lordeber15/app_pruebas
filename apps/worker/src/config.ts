import { z } from 'zod';

/** Variables de entorno del worker (doc. 03 §6). Sin valor, no arranca. */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL_WORKER: z.string().startsWith('postgres'),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET_ARCHIVOS: z.string().min(1),
  S3_ACCESS_KEY_APP: z.string().min(1),
  S3_SECRET_KEY_APP: z.string().min(1),
});

export type ConfigWorker = z.infer<typeof esquema>;

export const leerConfig = (env: NodeJS.ProcessEnv = process.env): ConfigWorker => {
  const r = esquema.safeParse(env);
  if (!r.success) {
    throw new Error(
      `Configuración inválida: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  return r.data;
};
