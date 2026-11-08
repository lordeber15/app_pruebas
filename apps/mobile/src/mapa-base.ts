import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import capasBase from './capas-base.json';
import { carpetaGlifos, glifosCompletos, mapasDescargados } from './mapas.ts';
import { combinarEstilo } from './mapas-logica.ts';

/**
 * Mapa base (ADR-005: MapLibre + PMTiles; PoC-01; RF-M05, CA-08).
 * 1. Con áreas descargadas (src/mapas.ts): todas a la vez, desde la carpeta privada de la app,
 *    sin pedir nada a la red. Es lo que se ve en modo avión.
 * 2. Sin áreas y con señal: el mapa del propio servidor (`/mapa/base.pmtiles`), leído por rangos.
 * 3. Sin áreas ni señal: fondo neutro; las estaciones se dibujan igual.
 * Nunca se piden teselas a un servicio externo.
 */

const FONDO_NEUTRO = '#E7ECE9';
const capas = capasBase as StyleSpecification['layers'];

export type OrigenMapaBase = 'local' | 'servidor' | 'ninguno';

export interface MapaBase {
  /** Estilo para el componente `Map`. */
  readonly estilo: StyleSpecification;
  /** Hay teselas (locales o del servidor). */
  readonly conTeselas: boolean;
  readonly origen: OrigenMapaBase;
  /** Áreas descargadas que forman el mapa. */
  readonly areas: number;
}

export const estiloNeutro = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': FONDO_NEUTRO } }],
});

/** Mapa base del propio servidor (el mismo de la web), solo con señal. */
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
    layers: capas,
  };
};

/**
 * Elige el mapa base. `servidor` es la dirección del servidor solo si hay señal (null sin ella).
 * El recorte único `mapa/brigada.pmtiles` de antes ya no se usa: ningún flujo lo generaba.
 */
export const prepararMapaBase = async (servidor: string | null = null): Promise<MapaBase> => {
  const paquetes = await mapasDescargados();
  if (paquetes.length > 0)
    return {
      origen: 'local',
      conTeselas: true,
      areas: paquetes.length,
      estilo: combinarEstilo({
        paquetes,
        capas,
        fondo: FONDO_NEUTRO,
        glifos: glifosCompletos()
          ? `${carpetaGlifos.uri.replace(/\/$/, '')}/{fontstack}/{range}.pbf`
          : null,
      }),
    };
  return servidor === null
    ? { estilo: estiloNeutro(), conTeselas: false, origen: 'ninguno', areas: 0 }
    : { estilo: estiloServidor(servidor), conTeselas: true, origen: 'servidor', areas: 0 };
};
