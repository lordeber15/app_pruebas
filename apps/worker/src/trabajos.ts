import type { Db } from '@campo/db';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import type { Almacenamiento } from './almacenamiento.ts';
import { archivosPendientes, verificarArchivo } from './verificar.ts';

/**
 * Colas del worker (ADR-007, doc. 03 §7.2). La API no encola: solo avisa con NOTIFY
 * `archivo_subido`; el worker encola. Una revisión cada minuto recoge lo que quedó pendiente si
 * se perdió un aviso (por ejemplo, con el worker detenido).
 */
export const COLA_VERIFICAR = 'verificar_archivo';
export const COLA_PENDIENTES = 'buscar_archivos_pendientes';
const CANAL = 'archivo_subido';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Worker {
  readonly detener: () => Promise<void>;
}

export const iniciarTrabajos = async (
  url: string,
  db: Db,
  almacen: Almacenamiento,
  log: Logger,
): Promise<Worker> => {
  const boss = new PgBoss({ connectionString: url, schema: 'pgboss' });
  boss.on('error', (err: unknown) => {
    log.error({ err }, 'error de pg-boss');
  });
  await boss.start();

  // stately: como máximo un trabajo en cola y uno en curso por archivo.
  await boss.createQueue(COLA_VERIFICAR, { policy: 'stately', retryLimit: 5, retryBackoff: true });
  await boss.createQueue(COLA_PENDIENTES, { policy: 'singleton' });

  const encolar = async (archivoId: string): Promise<void> => {
    await boss.send(COLA_VERIFICAR, { archivo_id: archivoId }, { singletonKey: archivoId });
  };

  await boss.work<{ archivo_id: string }>(COLA_VERIFICAR, async (trabajos) => {
    for (const t of trabajos) {
      // Una foto puede tener la preview y el original pendientes: se verifican en orden.
      for (let i = 0; i < 2; i++) {
        const r = await verificarArchivo(db, almacen, t.data.archivo_id);
        if (r.accion === 'nada') break;
        // Solo el id del archivo: nada de rutas ni datos personales en los logs.
        log.info({ archivo_id: t.data.archivo_id, ...r }, 'verificación de archivo');
      }
    }
  });

  await boss.work(COLA_PENDIENTES, async () => {
    for (const id of await archivosPendientes(db)) await encolar(id);
  });
  await boss.schedule(COLA_PENDIENTES, '* * * * *');

  // Avisos de la API al terminar cada subida (post-finish de tusd).
  const oyente = new pg.Client({ connectionString: url });
  await oyente.connect();
  oyente.on('notification', (n) => {
    const id = n.payload ?? '';
    if (n.channel === CANAL && UUID.test(id)) {
      encolar(id).catch((err: unknown) => {
        log.error({ err }, 'no se pudo encolar la verificación');
      });
    }
  });
  await oyente.query(`LISTEN ${CANAL}`);

  return {
    detener: async () => {
      await oyente.end();
      await boss.stop();
    },
  };
};
