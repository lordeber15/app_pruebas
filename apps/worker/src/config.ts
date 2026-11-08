import { TAMANO_MAXIMO_PAQUETE_MAPA } from '@campo/core';
import { tmpdir } from 'node:os';
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
  // ── Paquetes de mapa sin conexión (RF-M05) ──
  /** Ejecutable de go-pmtiles (la imagen lo trae en /usr/local/bin). */
  MAPA_PMTILES_BIN: z.string().min(1).default('pmtiles'),
  /**
   * Mapa base a recortar: un archivo .pmtiles local o una URL https (p. ej. un build de
   * Protomaps, para llegar a zoom 15). Sin él, los paquetes quedan en error con un aviso claro.
   */
  MAPA_FUENTE: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('/') || v.startsWith('https://'), 'ruta absoluta o URL https')
    .default('/srv/mapa/base.pmtiles'),
  /** Bytes máximos de un paquete (por defecto 150 MB, dentro de V-10). */
  MAPA_TAMANO_MAXIMO: z.coerce.number().int().positive().default(TAMANO_MAXIMO_PAQUETE_MAPA),
  /** Carpeta de trabajo para los recortes (necesita espacio para un paquete completo). */
  MAPA_DIR_TEMPORAL: z.string().min(1).default(tmpdir()),
  /** Tiempo máximo de un recorte, en segundos. */
  MAPA_TIEMPO_MAXIMO_S: z.coerce.number().int().positive().max(1500).default(1200),
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
