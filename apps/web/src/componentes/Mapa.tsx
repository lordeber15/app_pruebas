import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';
import capasBase from './capas-base.json';

/**
 * Mapa con MapLibre + PMTiles (ADR-005). El mapa base sale de /mapa/base.pmtiles, servido por la
 * propia instalación; si no está cargado, se muestran solo las estaciones sobre un fondo neutro. Ningún servicio de mapas externo.
 */
let protocoloRegistrado = false;
const registrarProtocolo = () => {
  if (protocoloRegistrado) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  protocoloRegistrado = true;
};

const ORIGEN = typeof window === 'undefined' ? '' : window.location.origin;

const estiloBase = (conMapaBase: boolean): StyleSpecification => ({
  version: 8,
  glyphs: `${ORIGEN}/mapa/glifos/{fontstack}/{range}.pbf`,
  sources: conMapaBase
    ? {
        protomaps: {
          type: 'vector',
          url: `pmtiles://${ORIGEN}/mapa/base.pmtiles`,
          attribution: '© OpenStreetMap',
        },
      }
    : {},
  layers: conMapaBase
    ? (capasBase as StyleSpecification['layers'])
    : [{ id: 'fondo', type: 'background', paint: { 'background-color': '#e7ece9' } }],
});

export interface PuntoMapa {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly titulo: string;
  /** Estación en zona de amortiguamiento o ecosistema frágil (A01): se dibuja con un anillo doble. */
  readonly zaEf?: boolean;
}

/**
 * Geometría GeoJSON sobre el mapa (D02 §11): unidades (punto, línea o polígono) y tracks de una
 * ejecución. Los tracks se dibujan con línea discontinua para no depender solo del color.
 */
export interface CapaMapa {
  readonly id: string;
  readonly tipo: 'unidad' | 'track';
  readonly etiqueta: string;
  readonly geometria: { readonly type: string; readonly coordinates: unknown };
}

/**
 * Marcador accesible (botón en el DOM) para mostrar un estado: forma + ícono + color, con su
 * texto completo en `etiqueta` para lectores de pantalla y como información al pasar el puntero.
 * El color nunca es el único indicador.
 */
export interface MarcadorMapa {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly etiqueta: string;
  readonly icono: string;
  readonly forma: 'circulo' | 'cuadrado' | 'rombo';
  readonly fondo: string;
  readonly tinta: string;
  readonly elegido?: boolean;
}

const crearMarcador = (m: MarcadorMapa, alElegir: (id: string) => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', m.etiqueta);
  b.setAttribute('aria-pressed', m.elegido === true ? 'true' : 'false');
  b.title = m.etiqueta;
  const tam = m.elegido === true ? 30 : 24;
  Object.assign(b.style, {
    width: `${String(tam)}px`,
    height: `${String(tam)}px`,
    background: m.fondo,
    color: m.tinta,
    border: `2px solid ${m.elegido === true ? '#18231f' : '#ffffff'}`,
    borderRadius: m.forma === 'circulo' ? '9999px' : '3px',
    transform: m.forma === 'rombo' ? 'rotate(45deg)' : '',
    boxShadow: '0 0 0 1px rgba(24,35,31,0.55)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: '700 13px/1 system-ui, sans-serif',
    padding: '0',
  });
  const i = document.createElement('span');
  i.setAttribute('aria-hidden', 'true');
  i.textContent = m.icono;
  if (m.forma === 'rombo') i.style.transform = 'rotate(-45deg)';
  b.append(i);
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    alElegir(m.id);
  });
  return b;
};

type DatosGeoJson = Parameters<GeoJSONSource['setData']>[0];

/** Pares [lon, lat] de cualquier geometría GeoJSON, para encuadrar el mapa. */
const coordenadas = (c: unknown, acc: [number, number][] = []): [number, number][] => {
  if (!Array.isArray(c)) return acc;
  const [a, b] = c as unknown[];
  if (typeof a === 'number' && typeof b === 'number') acc.push([a, b]);
  else for (const x of c as unknown[]) coordenadas(x, acc);
  return acc;
};

const hayMapaBase = async (): Promise<boolean> => {
  try {
    const r = await fetch('/mapa/base.pmtiles', { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').includes('octet-stream');
  } catch {
    return false;
  }
};

const SIN_CAPAS: readonly CapaMapa[] = [];
const SIN_MARCADORES: readonly MarcadorMapa[] = [];

export const Mapa = ({
  puntos,
  capas = SIN_CAPAS,
  marcadores = SIN_MARCADORES,
  alElegir,
  alto = '32rem',
  etiqueta = 'Mapa de estaciones',
}: {
  puntos: readonly PuntoMapa[];
  capas?: readonly CapaMapa[];
  /** Estaciones con estado (avance): se dibujan como marcadores accesibles. */
  marcadores?: readonly MarcadorMapa[];
  alElegir?: (id: string) => void;
  alto?: string;
  etiqueta?: string;
}) => {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const [sinMapaBase, setSinMapaBase] = useState(false);
  const [listo, setListo] = useState(false);
  const enMapa = useRef<maplibregl.Marker[]>([]);
  const encuadrado = useRef('');
  const elegir = useRef(alElegir);
  elegir.current = alElegir;

  useEffect(() => {
    if (contenedor.current === null) return;
    registrarProtocolo();
    let cancelado = false;
    void hayMapaBase().then((base) => {
      if (cancelado || contenedor.current === null) return;
      setSinMapaBase(!base);
      const m = new maplibregl.Map({
        container: contenedor.current,
        style: estiloBase(base),
        center: [-75.0, -9.2],
        zoom: 4.5,
        attributionControl: { compact: true },
      });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      m.on('load', () => {
        m.addSource('capas', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        m.addLayer({
          id: 'capas-relleno',
          type: 'fill',
          source: 'capas',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#a86f1e', 'fill-opacity': 0.15 },
        });
        m.addLayer({
          id: 'capas-unidad-linea',
          type: 'line',
          source: 'capas',
          filter: [
            'all',
            ['==', ['get', 'tipo'], 'unidad'],
            ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']],
          ],
          paint: { 'line-color': '#a86f1e', 'line-width': 3 },
        });
        m.addLayer({
          id: 'capas-track',
          type: 'line',
          source: 'capas',
          filter: ['==', ['get', 'tipo'], 'track'],
          paint: { 'line-color': '#224639', 'line-width': 2, 'line-dasharray': [2, 1.5] },
        });
        m.addLayer({
          id: 'capas-unidad-punto',
          type: 'circle',
          source: 'capas',
          filter: ['all', ['==', ['get', 'tipo'], 'unidad'], ['==', ['geometry-type'], 'Point']],
          paint: {
            'circle-radius': 5,
            'circle-color': '#a86f1e',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        m.addSource('puntos', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        m.addLayer({
          id: 'za-ef',
          type: 'circle',
          source: 'puntos',
          filter: ['==', ['get', 'zaEf'], true],
          paint: {
            'circle-radius': 10,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#a86f1e',
            'circle-stroke-width': 2,
          },
        });
        m.addLayer({
          id: 'estaciones',
          type: 'circle',
          source: 'puntos',
          paint: {
            'circle-radius': 6,
            'circle-color': '#2e5e4e',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        m.on('click', 'estaciones', (ev) => {
          const id: unknown = ev.features?.[0]?.properties['id'];
          if (typeof id === 'string') elegir.current?.(id);
        });
        m.on('mouseenter', 'estaciones', () => {
          m.getCanvas().style.cursor = 'pointer';
        });
        m.on('mouseleave', 'estaciones', () => {
          m.getCanvas().style.cursor = '';
        });
        mapa.current = m;
        setListo(true);
      });
    });
    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!listo || m === null) return;
    void m.getSource<GeoJSONSource>('puntos')?.setData({
      type: 'FeatureCollection',
      features: puntos.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id, zaEf: p.zaEf === true },
      })),
    });
    void m.getSource<GeoJSONSource>('capas')?.setData({
      type: 'FeatureCollection',
      features: capas.map((c) => ({
        type: 'Feature',
        geometry: c.geometria,
        properties: { id: c.id, tipo: c.tipo, etiqueta: c.etiqueta },
      })),
    } as DatosGeoJson);
    for (const mk of enMapa.current) mk.remove();
    enMapa.current = marcadores.map((mk) =>
      new maplibregl.Marker({
        element: crearMarcador(mk, (id) => elegir.current?.(id)),
      })
        .setLngLat([mk.lon, mk.lat])
        .addTo(m),
    );
    const todos: [number, number][] = [
      ...puntos.map((p): [number, number] => [p.lon, p.lat]),
      ...marcadores.map((p): [number, number] => [p.lon, p.lat]),
      ...capas.flatMap((c) => coordenadas(c.geometria.coordinates)),
    ];
    // Encuadrar solo cuando cambia el conjunto de lugares (elegir un marcador no mueve el mapa).
    const clave = todos.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join(';');
    if (todos.length > 0 && clave !== encuadrado.current) {
      encuadrado.current = clave;
      const limites = new maplibregl.LngLatBounds();
      for (const c of todos) limites.extend(c);
      m.fitBounds(limites, { padding: 48, maxZoom: capas.length > 0 ? 18 : 15, duration: 0 });
    }
  }, [puntos, capas, marcadores, listo]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={contenedor}
        style={{ height: alto }}
        className="w-full overflow-hidden rounded-md border border-linea"
        role="region"
        aria-label={etiqueta}
      />
      {sinMapaBase ? (
        <p className="text-xs text-tinta-suave">
          Sin mapa base cargado: se muestran solo las estaciones. Cargue el archivo base.pmtiles en
          el servidor para ver el terreno.
        </p>
      ) : null}
    </div>
  );
};
