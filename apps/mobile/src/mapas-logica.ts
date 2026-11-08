import type { Bbox, EstadoPaqueteMapa, PaqueteMapa } from '@campo/core';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

/**
 * Lógica pura de los mapas sin conexión (RF-M05, CA-08): sin I/O ni módulos nativos, para poder
 * probarla sin el celular. La usan `mapas.ts` (descarga y catálogo), `mapa-base.ts` (estilo) y
 * las pantallas `mapas.tsx` y `mapa.tsx` (modo selección).
 */

type Capa = StyleSpecification['layers'][number];

// ── Catálogo local ─────────────────────────────────────────────────────────────────────────

/** Copia descargada y verificada de un paquete. */
export interface CopiaMapa {
  readonly version: number;
  readonly sha256: string;
  readonly tamano: number;
  readonly nombre: string;
  readonly bbox: Bbox;
  /** Nombre del archivo dentro de `mapa/paquetes/`. */
  readonly archivo: string;
  readonly descargado_en: string;
}

/** Descarga a medias (`<id>.part`): solo se reanuda si es de la misma versión y hash. */
export interface ParcialMapa {
  readonly version: number;
  readonly sha256: string;
  readonly tamano: number;
}

export interface FilaMapaLocal {
  readonly id: string;
  readonly proyecto_id: string;
  /** Lo último que dijo el servidor; null si ya no lo lista (la copia se conserva). */
  readonly servidor: PaqueteMapa | null;
  readonly copia: CopiaMapa | null;
  readonly parcial: ParcialMapa | null;
  /** El servidor recibió el aviso `/descargado` de la versión de la copia. */
  readonly confirmado: boolean;
  /** Último error de descarga o verificación en este celular. */
  readonly error: string | null;
}

/** Nombre del archivo final. Lleva la versión: una versión nueva nunca reutiliza el archivo ni la
 * URL `pmtiles://` de la anterior (hallazgo de PoC-01: el paquete nuevo reemplaza al anterior). */
export const archivoMapa = (id: string, version: number): string =>
  `${id}-v${String(version)}.pmtiles`;

export const archivoParcial = (id: string): string => `${id}.part`;

/**
 * Une el catálogo local de un proyecto con lo que acaba de responder el servidor: actualiza lo que
 * sigue, agrega lo nuevo y, de lo que ya no está, conserva solo lo que tiene copia descargada.
 */
export const fusionarCatalogo = (
  locales: readonly FilaMapaLocal[],
  delServidor: readonly PaqueteMapa[],
  proyectoId: string,
): { guardar: FilaMapaLocal[]; eliminar: FilaMapaLocal[] } => {
  const porId = new Map(locales.map((l) => [l.id, l]));
  const vistos = new Set<string>();
  const guardar: FilaMapaLocal[] = [];
  for (const p of delServidor) {
    vistos.add(p.id);
    const l = porId.get(p.id);
    guardar.push(
      l === undefined
        ? {
            id: p.id,
            proyecto_id: proyectoId,
            servidor: p,
            copia: null,
            parcial: null,
            confirmado: false,
            error: null,
          }
        : { ...l, servidor: p },
    );
  }
  const eliminar: FilaMapaLocal[] = [];
  for (const l of locales) {
    if (l.proyecto_id !== proyectoId || vistos.has(l.id)) continue;
    if (l.copia === null) eliminar.push(l);
    else guardar.push({ ...l, servidor: null, parcial: null });
  }
  return { guardar, eliminar };
};

export type EstadoLocalMapa =
  'descargando' | 'descargado' | 'desactualizado' | 'interrumpido' | 'no_descargado';

export const estadoLocalMapa = (
  f: FilaMapaLocal,
  descargandoId: string | null,
): EstadoLocalMapa => {
  if (descargandoId === f.id) return 'descargando';
  if (f.copia !== null) {
    const s = f.servidor;
    return s !== null && s.estado === 'listo' && s.version > f.copia.version
      ? 'desactualizado'
      : 'descargado';
  }
  return f.parcial === null ? 'no_descargado' : 'interrumpido';
};

export const ETIQUETA_ESTADO_LOCAL: Readonly<Record<EstadoLocalMapa, string>> = {
  descargando: 'Descargando',
  descargado: 'Descargado en este celular',
  desactualizado: 'Hay una versión nueva',
  interrumpido: 'Descarga interrumpida',
  no_descargado: 'No descargado',
};

export const ETIQUETA_ESTADO_SERVIDOR: Readonly<Record<EstadoPaqueteMapa, string>> = {
  pendiente: 'En cola en el servidor',
  generando: 'El servidor lo está preparando',
  listo: 'Listo en el servidor',
  error: 'El servidor no pudo prepararlo',
};

export type AccionMapa = 'descargar' | 'actualizar' | 'reintentar' | 'borrar';

/** Acciones que tienen sentido para el área; la red se comprueba aparte (`motivoSinDescarga`). */
export const accionesMapa = (f: FilaMapaLocal, estado: EstadoLocalMapa): AccionMapa[] => {
  if (estado === 'descargando') return [];
  const listo = f.servidor?.estado === 'listo';
  const acciones: AccionMapa[] = [];
  if (listo) {
    if (estado === 'desactualizado') acciones.push('actualizar');
    else if (estado === 'interrumpido' || (estado === 'no_descargado' && f.error !== null))
      acciones.push('reintentar');
    else if (estado === 'no_descargado') acciones.push('descargar');
  }
  if (f.copia !== null) acciones.push('borrar');
  return acciones;
};

/** Acciones que bajan datos: solo con WiFi no medida. */
export const accionUsaRed = (a: AccionMapa): boolean => a !== 'borrar';

// ── Red ────────────────────────────────────────────────────────────────────────────────────

/** Forma mínima del estado de NetInfo que importa aquí. */
export interface RedMapa {
  readonly type: string;
  readonly isConnected: boolean | null;
  readonly details: { readonly isConnectionExpensive?: boolean } | null;
}

/** Los mapas pesan hasta ~150 MB: solo se bajan con WiFi que el sistema no marca como medida. */
export const redPermiteDescargarMapa = (r: RedMapa): boolean =>
  r.isConnected === true && r.type === 'wifi' && r.details?.isConnectionExpensive !== true;

export const motivoSinDescarga = (r: RedMapa): string | null => {
  if (redPermiteDescargarMapa(r)) return null;
  if (r.isConnected !== true) return 'Sin conexión. Los mapas se descargan solo con WiFi.';
  if (r.type === 'wifi')
    return 'Esta red WiFi está marcada como medida. Los mapas se descargan solo con WiFi no medida.';
  return 'Está usando datos móviles. Los mapas se descargan solo con WiFi para no gastar sus datos.';
};

// ── Textos ─────────────────────────────────────────────────────────────────────────────────

const MB = 1024 * 1024;

export const textoMB = (bytes: number | null): string => {
  if (bytes === null) return 'Tamaño por conocer';
  const mb = bytes / MB;
  return `${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB`.replace('.', ',');
};

/** Porcentaje entero 0–100, o null si no se conoce el total (no es 0 %). */
export const porcentaje = (bytes: number, total: number | null): number | null =>
  total === null || total <= 0
    ? null
    : Math.max(0, Math.min(100, Math.floor((bytes / total) * 100)));

// ── Estilo ─────────────────────────────────────────────────────────────────────────────────

/** Fuentes (`text-font`) que usan las capas: son las carpetas de glifos que hay que descargar. */
export const fuentesDeCapas = (capas: readonly Capa[]): string[] => {
  const fuentes = new Set<string>();
  for (const c of capas) {
    if (c.type !== 'symbol') continue;
    const f: unknown = c.layout?.['text-font'];
    if (Array.isArray(f)) for (const x of f) if (typeof x === 'string') fuentes.add(x);
  }
  return [...fuentes];
};

export const prefijoFuente = (id: string): string => `paquete-${id}`;

/**
 * Estilo con todos los paquetes descargados: una fuente `pmtiles://` por paquete y cada capa del
 * mapa base repetida por fuente. Se intercalan por capa (agua de todos, luego vías de todos…) para
 * que el orden de dibujo sea el del estilo aunque las áreas se superpongan. El fondo va una vez.
 * Sin glifos locales no hay capas de texto: pedirlos fallaría sin señal.
 */
export const combinarEstilo = (opciones: {
  readonly paquetes: readonly { readonly id: string; readonly uri: string }[];
  readonly capas: readonly Capa[];
  readonly glifos: string | null;
  readonly fondo: string;
}): StyleSpecification => {
  const sources: StyleSpecification['sources'] = {};
  for (const p of opciones.paquetes)
    sources[prefijoFuente(p.id)] = {
      type: 'vector',
      url: `pmtiles://${p.uri}`,
      attribution: '© OpenStreetMap',
    };
  const layers: Capa[] = [];
  for (const c of opciones.capas) {
    if (c.type === 'background') {
      layers.push(c);
      continue;
    }
    if (c.type === 'symbol' && opciones.glifos === null) continue;
    for (const p of opciones.paquetes)
      layers.push({ ...c, id: `${c.id}__${p.id}`, source: prefijoFuente(p.id) });
  }
  if (!layers.some((c) => c.type === 'background'))
    layers.unshift({
      id: 'fondo',
      type: 'background',
      paint: { 'background-color': opciones.fondo },
    });
  return {
    version: 8,
    ...(opciones.glifos === null ? {} : { glyphs: opciones.glifos }),
    sources,
    layers,
  };
};

// ── Selección de área ──────────────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;
const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const latDeMercY = (y: number): number => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;
const redondear = (x: number): number => Math.round(x * 1e5) / 1e5;

/**
 * Área que cubre el marco fijo dibujado sobre el mapa. Con el mapa sin rotar ni inclinar, la
 * longitud es lineal en pantalla y la latitud lo es en Mercator. `vista` son los límites visibles
 * del mapa; `marco`, los márgenes del marco en dp dentro de una vista de `ancho` × `alto` dp.
 */
export const bboxDeMarco = (
  vista: readonly [number, number, number, number],
  tamano: { readonly ancho: number; readonly alto: number },
  marco: {
    readonly izquierda: number;
    readonly arriba: number;
    readonly derecha: number;
    readonly abajo: number;
  },
): Bbox | null => {
  const [o, s, e, n] = vista;
  if (tamano.ancho <= 0 || tamano.alto <= 0 || !(o < e) || !(s < n)) return null;
  const fx0 = marco.izquierda / tamano.ancho;
  const fx1 = 1 - marco.derecha / tamano.ancho;
  const fy0 = marco.arriba / tamano.alto;
  const fy1 = 1 - marco.abajo / tamano.alto;
  if (!(fx0 < fx1) || !(fy0 < fy1)) return null;
  const yN = mercY(n);
  const yS = mercY(s);
  const bbox: Bbox = [
    redondear(o + (e - o) * fx0),
    redondear(latDeMercY(yN - (yN - yS) * fy1)),
    redondear(o + (e - o) * fx1),
    redondear(latDeMercY(yN - (yN - yS) * fy0)),
  ];
  return bbox[0] < bbox[2] && bbox[1] < bbox[3] ? bbox : null;
};

export const textoLados = (l: { readonly ancho: number; readonly alto: number }): string => {
  const f = (x: number) => (x < 10 ? x.toFixed(1) : x.toFixed(0)).replace('.', ',');
  return `${f(l.ancho)} × ${f(l.alto)} km`;
};
