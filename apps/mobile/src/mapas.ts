import {
  crearPaqueteMapaSchema,
  descargaPaqueteMapaSchema,
  paqueteMapaSchema,
  validarAreaUsuario,
  type Bbox,
  type DescargaPaqueteMapa,
  type PaqueteMapa,
} from '@campo/core';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import NetInfo from '@react-native-community/netinfo';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { z } from 'zod';
import { create } from 'zustand';
import { consultar, ejecutar, guardarEstadoSync, leerEstadoSync } from './bd.ts';
import capasBase from './capas-base.json';
import { leerPaquete } from './campo.ts';
import { avisarCambio } from './estado.ts';
import {
  archivoMapa,
  archivoParcial,
  fusionarCatalogo,
  fuentesDeCapas,
  motivoSinDescarga,
  type CopiaMapa,
  type FilaMapaLocal,
  type ParcialMapa,
} from './mapas-logica.ts';
import { sha256DeArchivo } from './plataforma.ts';
import { ErrorServidor, pedir, servidor } from './sesion.ts';

/**
 * Mapas sin conexión en el celular (RF-M05, CA-08: el mapa se ve en modo avión).
 *
 * - Catálogo en `mapa_local` (op-sqlite): lo último que dijo el servidor y la copia descargada,
 *   para mostrarlo sin señal.
 * - Descarga solo con WiFi no medida, a `mapa/paquetes/<id>.part`, reanudable: en Android se
 *   reanuda desde el tamaño del `.part` con `Range` (expo-file-system `DownloadTask`), también con
 *   una URL firmada nueva y tras cerrar la app. Se verifica el SHA-256 leyendo por trozos y solo
 *   entonces pasa a `mapa/paquetes/<id>-v<versión>.pmtiles`, reemplazando la versión anterior.
 * - Glifos del estilo en `mapa/glifos/<fuente>/<rango>.pbf`, una sola vez.
 * - «Borrar» quita solo la copia local; el área sigue en el servidor.
 */

const raiz = new Directory(Paths.document, 'mapa');
const carpetaPaquetes = new Directory(raiz, 'paquetes');
export const carpetaGlifos = new Directory(raiz, 'glifos');

/** Rangos de glifos que necesitan las etiquetas en español (PoC-01). */
const RANGOS_GLIFOS = ['0-255', '256-511', '8192-8447'] as const;
const FUENTES = fuentesDeCapas(capasBase as StyleSpecification['layers']);
const INTENTOS = 3;

export class ErrorMapa extends Error {}

// ── Estado de la descarga en curso (solo en memoria) ───────────────────────────────────────

interface DescargaEnCurso {
  id: string | null;
  fase: 'descargando' | 'verificando' | null;
  bytes: number;
  total: number | null;
}

export const useDescargaMapa = create<DescargaEnCurso>(() => ({
  id: null,
  fase: null,
  bytes: 0,
  total: null,
}));

// ── Catálogo ───────────────────────────────────────────────────────────────────────────────

interface FilaBd {
  id: string;
  proyecto_id: string;
  servidor: string | null;
  copia: string | null;
  parcial: string | null;
  confirmado: number;
  error: string | null;
}

const json = (s: string | null): unknown => (s === null ? null : JSON.parse(s));

const deBd = (f: FilaBd): FilaMapaLocal => ({
  id: f.id,
  proyecto_id: f.proyecto_id,
  servidor: json(f.servidor) as PaqueteMapa | null,
  copia: json(f.copia) as CopiaMapa | null,
  parcial: json(f.parcial) as ParcialMapa | null,
  confirmado: f.confirmado === 1,
  error: f.error,
});

export const leerCatalogo = async (): Promise<FilaMapaLocal[]> =>
  (await consultar<FilaBd>('SELECT * FROM mapa_local'))
    .map(deBd)
    .sort((a, b) =>
      (a.servidor?.nombre ?? a.copia?.nombre ?? '').localeCompare(
        b.servidor?.nombre ?? b.copia?.nombre ?? '',
        'es',
      ),
    );

const leerFila = async (id: string): Promise<FilaMapaLocal | null> => {
  const [f] = await consultar<FilaBd>('SELECT * FROM mapa_local WHERE id = ?', [id]);
  return f === undefined ? null : deBd(f);
};

const guardarFila = (f: FilaMapaLocal) =>
  ejecutar(
    `INSERT INTO mapa_local (id, proyecto_id, servidor, copia, parcial, confirmado, error, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET proyecto_id = excluded.proyecto_id, servidor = excluded.servidor,
       copia = excluded.copia, parcial = excluded.parcial, confirmado = excluded.confirmado,
       error = excluded.error, actualizado_en = excluded.actualizado_en`,
    [
      f.id,
      f.proyecto_id,
      f.servidor === null ? null : JSON.stringify(f.servidor),
      f.copia === null ? null : JSON.stringify(f.copia),
      f.parcial === null ? null : JSON.stringify(f.parcial),
      f.confirmado ? 1 : 0,
      f.error,
      new Date().toISOString(),
    ],
  );

const borrarArchivo = (f: File) => {
  try {
    if (f.exists) f.delete();
  } catch {
    // Si no se pudo borrar, el catálogo ya no lo usa; se reintenta al volver a descargar.
  }
};

const CLAVE_REFRESCO = 'mapas_refrescado_en';
export const ultimoRefresco = () => leerEstadoSync(CLAVE_REFRESCO);

/** Proyectos del paquete de campo: los mapas se piden por proyecto. */
export const proyectosDelPaquete = async () =>
  (await leerPaquete())?.paquete.proyectos.map((p) => ({ id: p.id, nombre: p.nombre })) ?? [];

/** Pide al servidor la lista de áreas (necesita señal) y la une con lo local. */
export const refrescarMapas = async (): Promise<void> => {
  const proyectos = await proyectosDelPaquete();
  if (proyectos.length === 0)
    throw new ErrorMapa('Descargue primero el paquete de campo desde Inicio.');
  for (const p of proyectos) {
    const r = await pedir<{ paquetes: unknown }>('GET', `/api/v1/proyectos/${p.id}/mapas`);
    const lista = z.array(paqueteMapaSchema).safeParse(r.paquetes);
    if (!lista.success) throw new ErrorMapa('El servidor respondió una lista de mapas inválida.');
    const { guardar, eliminar } = fusionarCatalogo(await leerCatalogo(), lista.data, p.id);
    for (const f of guardar) await guardarFila(f);
    for (const f of eliminar) {
      borrarArchivo(new File(carpetaPaquetes, archivoParcial(f.id)));
      await ejecutar('DELETE FROM mapa_local WHERE id = ?', [f.id]);
    }
  }
  await guardarEstadoSync(CLAVE_REFRESCO, new Date().toISOString());
  await confirmarPendientes();
};

/** Avisa al servidor las copias verificadas que aún no confirmó (p. ej. si se cortó la señal). */
const confirmarPendientes = async (): Promise<void> => {
  for (const f of await leerCatalogo()) {
    if (f.confirmado || f.copia === null || f.servidor?.version !== f.copia.version) continue;
    try {
      await pedir<undefined>('POST', `/api/v1/mapas/${f.id}/descargado`, {
        version: f.copia.version,
      });
      await guardarFila({ ...f, confirmado: true });
    } catch {
      // Se vuelve a intentar en el próximo refresco.
    }
  }
};

/** Pide un área nueva marcada por el usuario. El servidor la genera y luego se descarga. */
export const solicitarArea = async (entrada: {
  proyectoId: string;
  nombre: string;
  bbox: Bbox;
  brigadaId?: string;
}): Promise<PaqueteMapa> => {
  const cuerpo = crearPaqueteMapaSchema.safeParse({
    nombre: entrada.nombre,
    bbox: entrada.bbox,
    ...(entrada.brigadaId === undefined ? {} : { brigada_id: entrada.brigadaId }),
  });
  if (!cuerpo.success) throw new ErrorMapa('Revise el nombre y el área marcada.');
  const tamano = validarAreaUsuario(cuerpo.data.bbox);
  if (!tamano.ok) throw new ErrorMapa(tamano.mensaje);
  const r = await pedir<unknown>(
    'POST',
    `/api/v1/proyectos/${entrada.proyectoId}/mapas`,
    cuerpo.data,
  );
  const p = paqueteMapaSchema.safeParse(r);
  if (!p.success) throw new ErrorMapa('El servidor aceptó el área, pero su respuesta es inválida.');
  const previo = await leerFila(p.data.id);
  await guardarFila({
    id: p.data.id,
    proyecto_id: entrada.proyectoId,
    servidor: p.data,
    copia: previo?.copia ?? null,
    parcial: previo?.parcial ?? null,
    confirmado: previo?.confirmado ?? false,
    error: null,
  });
  return p.data;
};

// ── Descarga ───────────────────────────────────────────────────────────────────────────────

const pedirDescarga = async (id: string): Promise<DescargaPaqueteMapa> => {
  let r: unknown;
  try {
    r = await pedir<unknown>('GET', `/api/v1/mapas/${id}/descarga`);
  } catch (err) {
    if (err instanceof ErrorServidor && err.estado === 409)
      throw new ErrorMapa('El servidor todavía está preparando esta área. Intente más tarde.');
    throw err;
  }
  const d = descargaPaqueteMapaSchema.safeParse(r);
  if (!d.success) throw new ErrorMapa('El servidor respondió una descarga inválida.');
  // La URL firmada puede venir relativa al servidor.
  if (d.data.url.startsWith('/')) {
    const base = (await servidor()).replace(/\/$/, '');
    return { ...d.data, url: `${base}${d.data.url}` };
  }
  return d.data;
};

/** Control para pausar el tramo en curso si se pierde la WiFi no medida. */
interface Control {
  pausar: (() => void) | null;
  sinWifi: boolean;
}

/**
 * Un tramo de descarga. En Android, `resumeData` del `DownloadTask` es el desplazamiento en bytes
 * y el reanudar manda `Range: bytes=<desde>-` a la URL que se le dé: por eso se reanuda con una URL
 * firmada nueva y aun después de cerrar la app. En iOS los datos de reanudación son opacos y
 * atados a la URL original: se empieza de cero.
 */
const tramo = async (
  url: string,
  parte: File,
  control: Control,
  alProgreso: (bytes: number) => void,
): Promise<'completo' | 'pausado'> => {
  const desde = parte.exists ? parte.size : 0;
  const reanudar = desde > 0 && Platform.OS === 'android';
  const opciones = { onProgress: (p: { bytesWritten: number }) => alProgreso(p.bytesWritten) };
  if (!reanudar) borrarArchivo(parte);
  const tarea = reanudar
    ? DownloadTask.fromSavable(
        { url, fileUri: parte.uri, isDirectory: false, resumeData: String(desde) },
        opciones,
      )
    : new DownloadTask(url, parte, opciones);
  control.pausar = () => {
    try {
      tarea.pause();
    } catch {
      // Ya terminó o no estaba activa.
    }
  };
  try {
    const r = reanudar ? await tarea.resumeAsync() : await tarea.downloadAsync();
    return r === null ? 'pausado' : 'completo';
  } finally {
    control.pausar = null;
    tarea.release();
  }
};

/** Glifos del estilo, una sola vez; si faltan, el mapa se ve sin textos (nunca se bloquea). */
const asegurarGlifos = async (): Promise<void> => {
  const base = (await servidor()).replace(/\/$/, '');
  for (const fuente of FUENTES) {
    const carpeta = new Directory(carpetaGlifos, fuente);
    if (!carpeta.exists) carpeta.create({ intermediates: true });
    for (const rango of RANGOS_GLIFOS) {
      const destino = new File(carpeta, `${rango}.pbf`);
      if (destino.exists) continue;
      const temporal = new File(carpeta, `${rango}.pbf.part`);
      borrarArchivo(temporal);
      await File.downloadFileAsync(
        `${base}/mapa/glifos/${encodeURIComponent(fuente)}/${rango}.pbf`,
        temporal,
        { idempotent: true },
      );
      await temporal.move(destino);
    }
  }
};

export const glifosCompletos = (): boolean =>
  FUENTES.length > 0 &&
  FUENTES.every((f) =>
    RANGOS_GLIFOS.every((r) => new File(new Directory(carpetaGlifos, f), `${r}.pbf`).exists),
  );

const conError = async (id: string, mensaje: string): Promise<never> => {
  const f = await leerFila(id);
  if (f !== null) await guardarFila({ ...f, error: mensaje });
  throw new ErrorMapa(mensaje);
};

/**
 * Descarga o actualiza un área. Solo con WiFi no medida; si se corta, deja el `.part` para
 * reanudar. Devuelve 'pausado' si se detuvo por perder la WiFi.
 */
export const descargarMapa = async (id: string): Promise<'listo' | 'pausado'> => {
  if (useDescargaMapa.getState().id !== null)
    throw new ErrorMapa('Ya hay un mapa descargándose. Espere a que termine.');
  const motivo = motivoSinDescarga(await NetInfo.fetch());
  if (motivo !== null) throw new ErrorMapa(motivo);
  const fila = await leerFila(id);
  if (fila?.servidor?.estado !== 'listo')
    throw new ErrorMapa('El área todavía no está lista en el servidor.');

  if (!carpetaPaquetes.exists) carpetaPaquetes.create({ intermediates: true });
  const parte = new File(carpetaPaquetes, archivoParcial(id));
  const control: Control = { pausar: null, sinWifi: false };
  useDescargaMapa.setState({ id, fase: 'descargando', bytes: 0, total: fila.servidor.tamano });
  const red = NetInfo.addEventListener((s) => {
    if (motivoSinDescarga(s) !== null) {
      control.sinWifi = true;
      control.pausar?.();
    }
  });
  try {
    let d = await pedirDescarga(id);
    for (let intento = 1; ; intento++) {
      // Un .part de otra versión no se mezcla con la nueva.
      const actual = await leerFila(id);
      if (actual === null) throw new ErrorMapa('El área ya no está en este celular.');
      const p = actual.parcial;
      if (p === null || p.version !== d.version || p.sha256 !== d.sha256) {
        borrarArchivo(parte);
        await guardarFila({
          ...actual,
          parcial: { version: d.version, sha256: d.sha256, tamano: d.tamano },
          error: null,
        });
      }
      useDescargaMapa.setState({ total: d.tamano, bytes: parte.exists ? parte.size : 0 });
      if (parte.exists && parte.size === d.tamano) break;
      try {
        const r = await tramo(d.url, parte, control, (bytes) =>
          useDescargaMapa.setState({ bytes }),
        );
        if (r === 'completo') break;
        if (control.sinWifi) return 'pausado';
        throw new Error('Descarga detenida.');
      } catch (err) {
        if (control.sinWifi) return 'pausado';
        if (intento >= INTENTOS) throw err;
        // La URL firmada dura ≤ 15 min: cada reintento pide otra y sigue desde lo descargado.
        d = await pedirDescarga(id);
      }
    }

    useDescargaMapa.setState({ fase: 'verificando' });
    const { hash, tamano } = await sha256DeArchivo(parte.uri);
    if (hash.toLowerCase() !== d.sha256.toLowerCase() || tamano !== d.tamano) {
      borrarArchivo(parte);
      const f = await leerFila(id);
      if (f !== null) await guardarFila({ ...f, parcial: null });
      return await conError(
        id,
        'El archivo descargado no coincide con el del servidor (verificación SHA-256). Se borró; vuelva a intentarlo.',
      );
    }

    // Solo con el hash verificado se reemplaza la versión anterior completa.
    const nombre = archivoMapa(id, d.version);
    const final = new File(carpetaPaquetes, nombre);
    await parte.move(final, { overwrite: true });
    const f = await leerFila(id);
    if (f === null) throw new ErrorMapa('El área ya no está en este celular.');
    if (f.copia !== null && f.copia.archivo !== nombre)
      borrarArchivo(new File(carpetaPaquetes, f.copia.archivo));
    const srv = f.servidor;
    await guardarFila({
      ...f,
      copia: {
        version: d.version,
        sha256: d.sha256,
        tamano: d.tamano,
        nombre: srv?.nombre ?? f.copia?.nombre ?? 'Área',
        bbox: srv?.bbox ?? f.copia?.bbox ?? [0, 0, 0, 0],
        archivo: nombre,
        descargado_en: new Date().toISOString(),
      },
      parcial: null,
      confirmado: false,
      error: null,
    });

    try {
      await asegurarGlifos();
    } catch {
      // Sin glifos el mapa se ve igual, sin textos; se reintentan en la próxima descarga.
    }
    try {
      await pedir<undefined>('POST', `/api/v1/mapas/${id}/descargado`, { version: d.version });
      const g = await leerFila(id);
      if (g !== null) await guardarFila({ ...g, confirmado: true });
    } catch {
      // Se confirma en el próximo refresco con señal.
    }
    return 'listo';
  } catch (err) {
    if (err instanceof ErrorMapa) throw err;
    const mensaje =
      err instanceof ErrorServidor
        ? err.message
        : 'La descarga se interrumpió. Toque «Reintentar»: seguirá desde donde quedó.';
    return await conError(id, mensaje);
  } finally {
    red();
    useDescargaMapa.setState({ id: null, fase: null, bytes: 0, total: null });
    avisarCambio();
  }
};

/** Borra solo la copia de este celular (y lo descargado a medias); el área sigue en el servidor. */
export const borrarCopiaMapa = async (id: string): Promise<void> => {
  const f = await leerFila(id);
  if (f === null) return;
  if (f.copia !== null) borrarArchivo(new File(carpetaPaquetes, f.copia.archivo));
  borrarArchivo(new File(carpetaPaquetes, archivoParcial(id)));
  if (f.servidor === null) await ejecutar('DELETE FROM mapa_local WHERE id = ?', [id]);
  else await guardarFila({ ...f, copia: null, parcial: null, confirmado: false, error: null });
  avisarCambio();
};

/** Paquetes descargados cuyo archivo existe, para armar el estilo del mapa. */
export const mapasDescargados = async (): Promise<{ id: string; uri: string }[]> =>
  (await leerCatalogo()).flatMap((f) => {
    if (f.copia === null) return [];
    const archivo = new File(carpetaPaquetes, f.copia.archivo);
    return archivo.exists ? [{ id: f.id, uri: archivo.uri }] : [];
  });
