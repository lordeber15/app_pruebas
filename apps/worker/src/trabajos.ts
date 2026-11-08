import type { Db } from '@campo/db';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import type { Almacenamiento } from './almacenamiento.ts';
import { generarPaqueteMapa, paquetesPendientes, type OpcionesMapa } from './mapas.ts';
import { ejecucionDeArchivo, ejecucionesListas, evaluarEjecucionQa } from './qa.ts';
import { archivosPendientes, verificarArchivo } from './verificar.ts';

/**
 * Colas del worker (ADR-007, doc. 03 §7.2). La API no encola: solo avisa con NOTIFY
 * `archivo_subido`; el worker encola. Una revisión cada minuto recoge lo que quedó pendiente si
 * se perdió un aviso (por ejemplo, con el worker detenido).
 *
 * QA post-sincronización (RN-05, RN-31): al terminar la verificación de una foto, y al recibir el
 * aviso `ejecucion_cerrada` de la API, se encola la evaluación de su ejecución; una revisión cada
 * minuto recoge las ejecuciones en `evidencia_pendiente` que ya no esperan fotos.
 *
 * Paquetes de mapa (RF-M05): la API avisa con NOTIFY `paquete_mapa`; los recortes van de a uno
 * (pesan en CPU y disco) y una revisión cada minuto recoge los pendientes y los colgados.
 */
export const COLA_VERIFICAR = 'verificar_archivo';
export const COLA_PENDIENTES = 'buscar_archivos_pendientes';
export const COLA_QA = 'evaluar_ejecucion';
export const COLA_QA_PENDIENTES = 'buscar_ejecuciones_listas';
const CANAL = 'archivo_subido';
const CANAL_CIERRE = 'ejecucion_cerrada';
export const COLA_MAPA = 'generar_paquete_mapa';
export const COLA_MAPA_PENDIENTES = 'buscar_paquetes_mapa_pendientes';
const CANAL_MAPA = 'paquete_mapa';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Worker {
  readonly detener: () => Promise<void>;
}

export const iniciarTrabajos = async (
  url: string,
  db: Db,
  almacen: Almacenamiento,
  log: Logger,
  /** Sin opciones de mapa no se registran sus colas (pruebas de otras colas). */
  mapa?: OpcionesMapa,
): Promise<Worker> => {
  const boss = new PgBoss({ connectionString: url, schema: 'pgboss' });
  boss.on('error', (err: unknown) => {
    log.error({ err }, 'error de pg-boss');
  });
  await boss.start();

  // stately: como máximo un trabajo en cola y uno en curso por archivo.
  await boss.createQueue(COLA_VERIFICAR, { policy: 'stately', retryLimit: 5, retryBackoff: true });
  await boss.createQueue(COLA_PENDIENTES, { policy: 'singleton' });
  await boss.createQueue(COLA_QA, { policy: 'stately', retryLimit: 5, retryBackoff: true });
  await boss.createQueue(COLA_QA_PENDIENTES, { policy: 'singleton' });

  const encolar = async (archivoId: string): Promise<void> => {
    await boss.send(COLA_VERIFICAR, { archivo_id: archivoId }, { singletonKey: archivoId });
  };

  const encolarQa = async (ejecucionId: string): Promise<void> => {
    await boss.send(COLA_QA, { ejecucion_id: ejecucionId }, { singletonKey: ejecucionId });
  };

  await boss.work<{ archivo_id: string }>(COLA_VERIFICAR, async (trabajos) => {
    for (const t of trabajos) {
      // Una foto puede tener la preview y el original pendientes: se verifican en orden.
      let verifico = false;
      for (let i = 0; i < 2; i++) {
        const r = await verificarArchivo(db, almacen, t.data.archivo_id);
        if (r.accion === 'nada') break;
        verifico = true;
        // Solo el id del archivo: nada de rutas ni datos personales en los logs.
        log.info({ archivo_id: t.data.archivo_id, ...r }, 'verificación de archivo');
      }
      if (verifico) {
        const ejecucionId = await ejecucionDeArchivo(db, t.data.archivo_id);
        if (ejecucionId !== null) await encolarQa(ejecucionId);
      }
    }
  });

  await boss.work<{ ejecucion_id: string }>(COLA_QA, async (trabajos) => {
    for (const t of trabajos) {
      const r = await evaluarEjecucionQa(db, t.data.ejecucion_id);
      if (r.accion === 'evaluada') {
        log.info({ ejecucion_id: t.data.ejecucion_id, ...r }, 'QA post-sincronización');
      } else if (r.motivo !== 'FOTOS_PENDIENTES' && r.motivo !== 'YA_EVALUADA') {
        log.warn({ ejecucion_id: t.data.ejecucion_id, motivo: r.motivo }, 'QA sin evaluar');
      }
    }
  });

  await boss.work(COLA_QA_PENDIENTES, async () => {
    for (const id of await ejecucionesListas(db)) await encolarQa(id);
  });
  await boss.schedule(COLA_QA_PENDIENTES, '* * * * *');

  await boss.work(COLA_PENDIENTES, async () => {
    for (const id of await archivosPendientes(db)) await encolar(id);
  });
  await boss.schedule(COLA_PENDIENTES, '* * * * *');

  const encolarMapa = async (paqueteId: string): Promise<void> => {
    await boss.send(COLA_MAPA, { paquete_id: paqueteId }, { singletonKey: paqueteId });
  };

  if (mapa !== undefined) {
    // Un recorte puede tardar: hasta 30 min activo antes de que pg-boss lo dé por perdido.
    await boss.createQueue(COLA_MAPA, {
      policy: 'stately',
      retryLimit: 3,
      retryBackoff: true,
      expireInSeconds: 1800,
    });
    await boss.createQueue(COLA_MAPA_PENDIENTES, { policy: 'singleton' });
    await boss.work<{ paquete_id: string }>(
      COLA_MAPA,
      { localConcurrency: 1, batchSize: 1 },
      async (trabajos) => {
        for (const t of trabajos) {
          const r = await generarPaqueteMapa(db, almacen, mapa, t.data.paquete_id);
          // Solo ids y resultado: ni rutas ni áreas en los logs.
          if (r.accion !== 'nada')
            log.info({ paquete_id: t.data.paquete_id, ...r }, 'paquete de mapa');
        }
      },
    );
    await boss.work(COLA_MAPA_PENDIENTES, async () => {
      for (const id of await paquetesPendientes(db)) await encolarMapa(id);
    });
    await boss.schedule(COLA_MAPA_PENDIENTES, '* * * * *');
  }

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
    if (mapa !== undefined && n.channel === CANAL_MAPA && UUID.test(id)) {
      encolarMapa(id).catch((err: unknown) => {
        log.error({ err }, 'no se pudo encolar el paquete de mapa');
      });
    }
    if (n.channel === CANAL_CIERRE && UUID.test(id)) {
      encolarQa(id).catch((err: unknown) => {
        log.error({ err }, 'no se pudo encolar la evaluación');
      });
    }
  });
  await oyente.query(`LISTEN ${CANAL}`);
  await oyente.query(`LISTEN ${CANAL_CIERRE}`);
  if (mapa !== undefined) await oyente.query(`LISTEN ${CANAL_MAPA}`);

  return {
    detener: async () => {
      await oyente.end();
      await boss.stop();
    },
  };
};
