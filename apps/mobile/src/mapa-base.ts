import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { Directory, File, Paths } from 'expo-file-system';
import capasBase from './capas-base.json';

/**
 * Mapa base sin conexión (ADR-005: MapLibre + PMTiles; PoC-01). Se usa un recorte local
 * `mapa/brigada.pmtiles` en la carpeta privada de la app; si no existe, las estaciones se dibujan
 * sobre un fondo neutro. Nunca se piden teselas a un servicio externo.
 *
 * TODO(bloque 8, paquete cartográfico): el servidor solo publica `/mapa/base.pmtiles` (todo el
 * Perú, ~210 MB), demasiado grande para un celular, y la PoC-01 no probó ninguna forma de
 * descargar un recorte por encuadre. Cuando el servidor genere el recorte por brigada, la descarga
 * (solo con WiFi) debe dejar aquí `brigada.pmtiles` y los glifos en `glifos/NotoSansRegular/`.
 * Cada paquete nuevo debe reemplazar el anterior por completo (hallazgo de PoC-01).
 */

const FUENTE = 'NotoSansRegular';
/** Rangos de glifos que necesitan las etiquetas en español (PoC-01). */
const RANGOS_GLIFOS = ['0-255', '256-511', '8192-8447'] as const;

const FONDO_NEUTRO = '#E7ECE9';

export interface MapaBase {
  /** Estilo para el componente `Map`. */
  readonly estilo: StyleSpecification;
  /** Hay recorte local con teselas. */
  readonly conTeselas: boolean;
}

export const estiloNeutro = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': FONDO_NEUTRO } }],
});

/**
 * Mapa base del propio servidor (`/mapa/base.pmtiles`, el mismo de la web), leído por rangos solo
 * con señal: es un respaldo mientras no exista el recorte por brigada (bloque 8). MapLibre guarda
 * en su caché lo ya visto, pero eso no reemplaza el paquete sin conexión.
 */
const estiloServidor = (servidor: string): StyleSpecification => {
  const base = servidor.replace(/\/$/, '');
  return {
    version: 8,
    glyphs: `${base}/mapa/glifos/{fontstack}/{range}.pbf`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${base}/mapa/base.pmtiles`,
        attribution: '© OpenStreetMap',
      },
    },
    layers: capasBase as StyleSpecification['layers'],
  };
};

/**
 * Elige el mapa base: el recorte local si existe; si no, con señal, el del servidor; sin ninguno,
 * el fondo neutro (las estaciones se dibujan igual).
 */
export const prepararMapaBase = (servidor: string | null = null): MapaBase => {
  const carpeta = new Directory(Paths.document, 'mapa');
  const pmtiles = new File(carpeta, 'brigada.pmtiles');
  if (!pmtiles.exists)
    return servidor === null
      ? { estilo: estiloNeutro(), conTeselas: false }
      : { estilo: estiloServidor(servidor), conTeselas: true };

  const glifos = new Directory(carpeta, 'glifos');
  const conGlifos = RANGOS_GLIFOS.every(
    (r) => new File(new Directory(glifos, FUENTE), `${r}.pbf`).exists,
  );
  const capas = capasBase as StyleSpecification['layers'];
  return {
    conTeselas: true,
    estilo: {
      version: 8,
      // Sin glifos locales no se dibujan los textos del mapa base: pedirlos fallaría sin señal.
      ...(conGlifos ? { glyphs: `${glifos.uri.replace(/\/$/, '')}/{fontstack}/{range}.pbf` } : {}),
      sources: {
        protomaps: {
          type: 'vector',
          url: `pmtiles://${pmtiles.uri}`,
          attribution: '© OpenStreetMap',
        },
      },
      layers: conGlifos ? capas : capas.filter((c) => c.type !== 'symbol'),
    },
  };
};
