import { crearGeneradorUuidV7 } from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { execFile } from 'node:child_process';
import { createHash, randomFillSync } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, constants, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Almacenamiento } from './almacenamiento.ts';

/**
 * Generación de paquetes de mapa sin conexión (RF-M05, CA-08, V-10).
 *
 * `pendiente` → `generando` → `listo` | `error`. Recorta el mapa base PMTiles al área con
 * `pmtiles extract` (go-pmtiles, sin shell), lo sube al almacenamiento y guarda tamaño y SHA-256
 * para que el celular verifique su copia. Si el paquete cambió de versión mientras se generaba
 * (otra área, «regenerar»), el resultado se descarta y queda la versión nueva pendiente.
 *
 * Los mensajes de `error` son para el usuario; en los logs solo van ids (nada de rutas ni áreas).
 */

/** Ejecuta `pmtiles` con argumentos (sin shell). Inyectable para las pruebas. */
export type EjecutarPmtiles = (
  bin: string,
  args: readonly string[],
  opciones: { readonly timeoutMs: number },
) => Promise<void>;

export const ejecutarPmtiles: EjecutarPmtiles = (bin, args, { timeoutMs }) =>
  new Promise((resolver, rechazar) => {
    execFile(
      bin,
      [...args],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err) => {
        if (err === null) resolver();
        // Sin el comando ni la salida: llevan rutas y el área.
        else rechazar(new ErrorPmtiles(typeof err.code === 'number' ? err.code : null));
      },
    );
  });

export class ErrorPmtiles extends Error {
  readonly salida: number | null;
  constructor(salida: number | null) {
    super(`pmtiles terminó con error (${String(salida)})`);
    this.name = 'ErrorPmtiles';
    this.salida = salida;
  }
}

export interface OpcionesMapa {
  readonly bin: string;
  readonly fuente: string;
  readonly tamanoMaximo: number;
  readonly dirTemporal: string;
  readonly timeoutMs: number;
  readonly ejecutar?: EjecutarPmtiles;
}

/** Generaciones que llevan más de esto en `generando` se consideran colgadas. */
const COLGADO = sql`interval '30 minutes'`;
const generarId = crearGeneradorUuidV7((n) => randomFillSync(new Uint8Array(n)));

export type ResultadoMapa =
  | { readonly accion: 'nada' }
  | { readonly accion: 'descartado'; readonly version: number }
  | { readonly accion: 'error'; readonly motivo: string; readonly version: number }
  | {
      readonly accion: 'listo';
      readonly version: number;
      readonly tamano: number;
      readonly zoom: number;
    };

const MB = 1024 * 1024;

export const mensajeTamano = (tamano: number, maximo: number): string =>
  `El área pesa ${(tamano / MB).toFixed(0)} MB; el máximo es ${(maximo / MB).toFixed(0)} MB. Marque un área más pequeña.`;

/** Zoom máximo del encabezado PMTiles v3 (byte 101); null si no es un PMTiles v3. */
export const zoomMaximoDe = async (ruta: string): Promise<number | null> => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta generada por el worker (carpeta de trabajo + UUID v7); no viene del usuario.
  const f = await open(ruta, 'r');
  try {
    const b = Buffer.alloc(127);
    const { bytesRead } = await f.read(b, 0, 127, 0);
    if (bytesRead < 127 || b.toString('latin1', 0, 7) !== 'PMTiles' || b[7] !== 3) return null;
    return b[101] ?? null;
  } finally {
    await f.close();
  }
};

const sha256De = async (ruta: string): Promise<string> => {
  const hash = createHash('sha256');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta generada por el worker (carpeta de trabajo + UUID v7); no viene del usuario.
  for await (const trozo of createReadStream(ruta)) hash.update(trozo as Buffer);
  return hash.digest('hex');
};

const fuenteDisponible = async (fuente: string): Promise<boolean> => {
  if (fuente.startsWith('https://')) return true;
  try {
    await access(fuente, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

/** Paquetes pendientes, o en `generando` hace más de 30 minutos (worker caído a la mitad). */
export const paquetesPendientes = async (db: Db): Promise<string[]> =>
  (
    await db
      .selectFrom('paquete_mapa')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('estado', '=', 'pendiente'),
          eb.and([
            eb('estado', '=', 'generando'),
            eb('generando_desde', '<', sql<Date>`now() - ${COLGADO}`),
          ]),
        ]),
      )
      .orderBy('actualizado_en')
      .limit(100)
      .execute()
  ).map((p) => p.id);

/** Termina en error si la versión sigue siendo la que se generaba. */
const terminarConError = async (db: Db, id: string, version: number, mensaje: string) => {
  await db
    .updateTable('paquete_mapa')
    .set({ estado: 'error', error: mensaje.slice(0, 500), generando_desde: null })
    .where('id', '=', id)
    .where('version', '=', version)
    .where('estado', '=', 'generando')
    .execute();
};

export const generarPaqueteMapa = async (
  db: Db,
  almacen: Almacenamiento,
  o: OpcionesMapa,
  paqueteId: string,
): Promise<ResultadoMapa> => {
  const p = await db
    .updateTable('paquete_mapa')
    .set({ estado: 'generando', generando_desde: sql<Date>`now()`, error: null })
    .where('id', '=', paqueteId)
    .where((eb) =>
      eb.or([
        eb('estado', '=', 'pendiente'),
        eb.and([
          eb('estado', '=', 'generando'),
          eb('generando_desde', '<', sql<Date>`now() - ${COLGADO}`),
        ]),
      ]),
    )
    .returning(['id', 'proyecto_id', 'version', 'oeste', 'sur', 'este', 'norte', 'zoom_max'])
    .executeTakeFirst();
  if (p === undefined) return { accion: 'nada' };

  if (!(await fuenteDisponible(o.fuente))) {
    const motivo =
      'El mapa base no está instalado en el servidor. Pida al administrador que copie base.pmtiles en la carpeta del mapa o configure MAPA_FUENTE.';
    await terminarConError(db, p.id, p.version, motivo);
    return { accion: 'error', motivo: 'FUENTE_INEXISTENTE', version: p.version };
  }

  const temporal = path.join(o.dirTemporal, `mapa-${generarId()}.pmtiles`);
  try {
    try {
      await (o.ejecutar ?? ejecutarPmtiles)(
        o.bin,
        [
          'extract',
          '--quiet',
          o.fuente,
          temporal,
          `--bbox=${String(p.oeste)},${String(p.sur)},${String(p.este)},${String(p.norte)}`,
          `--maxzoom=${String(p.zoom_max)}`,
        ],
        { timeoutMs: o.timeoutMs },
      );
    } catch (err) {
      if (!(err instanceof ErrorPmtiles)) throw err;
      await terminarConError(
        db,
        p.id,
        p.version,
        'No se pudo recortar el mapa base para esta área. Intente regenerarlo; si se repite, avise al administrador.',
      );
      return { accion: 'error', motivo: 'PMTILES_FALLO', version: p.version };
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta generada por el worker (carpeta de trabajo + UUID v7); no viene del usuario.
    const { size: tamano } = await stat(temporal);
    if (tamano > o.tamanoMaximo) {
      await terminarConError(db, p.id, p.version, mensajeTamano(tamano, o.tamanoMaximo));
      return { accion: 'error', motivo: 'TAMANO_EXCEDIDO', version: p.version };
    }
    const zoomArchivo = await zoomMaximoDe(temporal);
    if (zoomArchivo === null) {
      await terminarConError(db, p.id, p.version, 'El recorte del mapa base no es válido.');
      return { accion: 'error', motivo: 'PMTILES_INVALIDO', version: p.version };
    }
    // El zoom real: el pedido, o menos si la fuente no llega (el base del VPS llega a 13).
    const zoom = Math.min(p.zoom_max, zoomArchivo);
    const sha256 = await sha256De(temporal);

    // ¿Sigue vigente esta versión? Si no, no vale la pena subirla.
    const vigente = await db
      .selectFrom('paquete_mapa')
      .select('version')
      .where('id', '=', p.id)
      .executeTakeFirst();
    if (vigente?.version !== p.version) return { accion: 'descartado', version: p.version };

    const clave = `proyectos/${p.proyecto_id}/mapas/${p.id}/${generarId()}.pmtiles`;
    await almacen.subirArchivo(clave, temporal, tamano, 'application/vnd.pmtiles');
    const r = await db
      .updateTable('paquete_mapa')
      .set({
        estado: 'listo',
        ruta_objeto: clave,
        tamano,
        sha256,
        zoom_max: zoom,
        generado_en: sql<Date>`now()`,
        generando_desde: null,
        error: null,
      })
      .where('id', '=', p.id)
      .where('version', '=', p.version)
      .where('estado', '=', 'generando')
      .executeTakeFirst();
    if (r.numUpdatedRows === 0n) return { accion: 'descartado', version: p.version };
    return { accion: 'listo', version: p.version, tamano, zoom };
  } catch (err) {
    // Falla inesperada (almacenamiento, disco): vuelve a pendiente para reintentarlo.
    await db
      .updateTable('paquete_mapa')
      .set({ estado: 'pendiente', generando_desde: null })
      .where('id', '=', p.id)
      .where('version', '=', p.version)
      .where('estado', '=', 'generando')
      .execute();
    throw err;
  } finally {
    await rm(temporal, { force: true });
  }
};
