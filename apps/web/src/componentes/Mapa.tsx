import type { Bbox } from '@campo/core';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 calcula la URL de su worker en tiempo de ejecución y Vite no lo copia al build:
// sin esto el worker da 404, no se dibuja ninguna tesela y el evento `load` nunca llega.
import urlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';
import capasBase from './capas-base.json';
import { poligonoDeBbox } from './rectangulo.ts';

/**
 * Mapa con MapLibre + PMTiles (ADR-005). El mapa base sale de /mapa/base.pmtiles, servido por la
 * propia instalación; si no está cargado, se muestran solo las estaciones sobre un fondo neutro. Ningún servicio de mapas externo.
 */
let protocoloRegistrado = false;
const registrarProtocolo = () => {
  if (protocoloRegistrado) return;
  maplibregl.setWorkerUrl(urlWorker);
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
 * `area`: rectángulo de un mapa sin conexión (RF-M05), con borde discontinuo y su etiqueta escrita.
 */
export interface CapaMapa {
  readonly id: string;
  readonly tipo: 'unidad' | 'track' | 'area';
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

/** Punto de una fuente agrupada (p. ej. cada foto en su coordenada GPS). */
export interface PuntoAgrupado {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * Fuente GeoJSON con `cluster: true`: los puntos cercanos se juntan en un círculo con su número
 * (clic = acercar hasta separarlos); cada punto suelto es un círculo con borde blanco y un punto
 * blanco al centro, distinto del marcador de estación. `lineas`: trazos tenues (p. ej. las fotos
 * de una misma ejecución en orden de captura). Son capas del lienzo, sin foco de teclado: quien
 * las use debe ofrecer otra vía accesible a los mismos elementos.
 */
export interface FuenteAgrupada {
  readonly puntos: readonly PuntoAgrupado[];
  readonly lineas?: readonly (readonly (readonly [number, number])[])[];
  readonly alElegir: (id: string) => void;
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

const bboxDeEsquinas = (a: maplibregl.LngLat, b: maplibregl.LngLat): Bbox => {
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  return [
    r(Math.min(a.lng, b.lng)),
    r(Math.min(a.lat, b.lat)),
    r(Math.max(a.lng, b.lng)),
    r(Math.max(a.lat, b.lat)),
  ];
};

const bboxVisible = (m: maplibregl.Map): Bbox => {
  const l = m.getBounds();
  return bboxDeEsquinas(l.getSouthWest(), l.getNorthEast());
};

const SIN_CAPAS: readonly CapaMapa[] = [];
const SIN_MARCADORES: readonly MarcadorMapa[] = [];

export const Mapa = ({
  puntos,
  agrupados = null,
  capas = SIN_CAPAS,
  marcadores = SIN_MARCADORES,
  alElegir,
  alto = '32rem',
  etiqueta = 'Mapa de estaciones',
  marcarRectangulo = false,
  alMarcarRectangulo,
  rectanguloMarcado = null,
  alCambiarVista,
}: {
  puntos: readonly PuntoMapa[];
  /** Fuente agrupada opcional (clusters); sin ella el mapa se comporta como siempre. */
  agrupados?: FuenteAgrupada | null;
  capas?: readonly CapaMapa[];
  /** Estaciones con estado (avance): se dibujan como marcadores accesibles. */
  marcadores?: readonly MarcadorMapa[];
  alElegir?: (id: string) => void;
  alto?: string;
  etiqueta?: string;
  /**
   * Modo dibujo (opcional): con `true`, un clic fija una esquina, mover el puntero muestra la vista
   * previa y el segundo clic fija la esquina opuesta. Escape cancela la primera esquina.
   */
  marcarRectangulo?: boolean;
  alMarcarRectangulo?: (bbox: Bbox) => void;
  /** Rectángulo ya marcado (borrador): se dibuja sin volver a encuadrar el mapa. */
  rectanguloMarcado?: Bbox | null;
  /** Área visible al terminar cada movimiento: alternativa de teclado para marcar un rectángulo. */
  alCambiarVista?: (bbox: Bbox) => void;
}) => {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const [sinMapaBase, setSinMapaBase] = useState(false);
  const [listo, setListo] = useState(false);
  const enMapa = useRef<maplibregl.Marker[]>([]);
  const encuadrado = useRef('');
  const elegir = useRef(alElegir);
  elegir.current = alElegir;
  const marcando = useRef(marcarRectangulo);
  marcando.current = marcarRectangulo;
  const alMarcar = useRef(alMarcarRectangulo);
  alMarcar.current = alMarcarRectangulo;
  const elegirAgrupado = useRef(agrupados?.alElegir);
  elegirAgrupado.current = agrupados?.alElegir;
  const alVista = useRef(alCambiarVista);
  alVista.current = alCambiarVista;
  const marcado = useRef(rectanguloMarcado);
  marcado.current = rectanguloMarcado;
  const esquina = useRef<maplibregl.LngLat | null>(null);
  const [conEsquina, setConEsquina] = useState(false);

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
      // `style.load` (no `load`): las estaciones se dibujan aunque una tesela del mapa base falle.
      m.once('style.load', () => {
        m.addSource('capas', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        m.addLayer({
          id: 'capas-area-relleno',
          type: 'fill',
          source: 'capas',
          filter: ['==', ['get', 'tipo'], 'area'],
          paint: { 'fill-color': '#2e5e4e', 'fill-opacity': 0.06 },
        });
        m.addLayer({
          id: 'capas-area-linea',
          type: 'line',
          source: 'capas',
          filter: ['==', ['get', 'tipo'], 'area'],
          paint: { 'line-color': '#224639', 'line-width': 2, 'line-dasharray': [3, 2] },
        });
        m.addLayer({
          id: 'capas-area-etiqueta',
          type: 'symbol',
          source: 'capas',
          filter: ['==', ['get', 'tipo'], 'area'],
          layout: {
            'text-field': ['get', 'etiqueta'],
            'text-font': ['NotoSansRegular'],
            'text-size': 13,
            'text-max-width': 12,
          },
          paint: {
            'text-color': '#18231f',
            'text-halo-color': '#ffffff',
            'text-halo-width': 2,
          },
        });
        m.addLayer({
          id: 'capas-relleno',
          type: 'fill',
          source: 'capas',
          filter: ['all', ['!=', ['get', 'tipo'], 'area'], ['==', ['geometry-type'], 'Polygon']],
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
        // Fuente agrupada (opcional): trazos tenues, grupos con su número y puntos sueltos.
        m.addSource('agrupados-lineas', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        m.addLayer({
          id: 'agrupados-lineas',
          type: 'line',
          source: 'agrupados-lineas',
          paint: { 'line-color': '#18231f', 'line-width': 1.5, 'line-opacity': 0.35 },
        });
        m.addSource('agrupados', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterRadius: 40,
          clusterMaxZoom: 19,
        });
        m.addLayer({
          id: 'agrupados-grupo',
          type: 'circle',
          source: 'agrupados',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#a86f1e',
            'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 22],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        m.addLayer({
          id: 'agrupados-numero',
          type: 'symbol',
          source: 'agrupados',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['NotoSansRegular'],
            'text-size': 13,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': '#5c3c10', 'text-halo-width': 1 },
        });
        m.addLayer({
          id: 'agrupados-punto',
          type: 'circle',
          source: 'agrupados',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#a86f1e',
            'circle-radius': 7,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        // Punto blanco al centro: la forma (anillo) distingue la foto del marcador de estación.
        m.addLayer({
          id: 'agrupados-centro',
          type: 'circle',
          source: 'agrupados',
          filter: ['!', ['has', 'point_count']],
          paint: { 'circle-color': '#ffffff', 'circle-radius': 2.5 },
        });
        m.on('click', 'agrupados-grupo', (ev) => {
          const grupo: unknown = ev.features?.[0]?.properties['cluster_id'];
          if (typeof grupo !== 'number') return;
          const centro = ev.lngLat;
          void m
            .getSource<GeoJSONSource>('agrupados')
            ?.getClusterExpansionZoom(grupo)
            .then((zoom) => m.easeTo({ center: centro, zoom }));
        });
        m.on('click', 'agrupados-punto', (ev) => {
          const id: unknown = ev.features?.[0]?.properties['id'];
          if (typeof id === 'string') elegirAgrupado.current?.(id);
        });
        for (const capa of ['agrupados-grupo', 'agrupados-punto']) {
          m.on('mouseenter', capa, () => {
            m.getCanvas().style.cursor = 'pointer';
          });
          m.on('mouseleave', capa, () => {
            m.getCanvas().style.cursor = '';
          });
        }
        // Rectángulo en dibujo o marcado (borrador): borde grueso discontinuo en ocre.
        m.addSource('dibujo', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        m.addLayer({
          id: 'dibujo-relleno',
          type: 'fill',
          source: 'dibujo',
          paint: { 'fill-color': '#a86f1e', 'fill-opacity': 0.12 },
        });
        m.addLayer({
          id: 'dibujo-linea',
          type: 'line',
          source: 'dibujo',
          paint: { 'line-color': '#a86f1e', 'line-width': 3, 'line-dasharray': [1.5, 1] },
        });
        const dibujar = (bbox: Bbox | null) => {
          void m.getSource<GeoJSONSource>('dibujo')?.setData({
            type: 'FeatureCollection',
            features:
              bbox === null
                ? []
                : [{ type: 'Feature', geometry: poligonoDeBbox(bbox), properties: {} }],
          });
        };
        m.on('click', (ev) => {
          if (!marcando.current) return;
          const a = esquina.current;
          if (a === null) {
            esquina.current = ev.lngLat;
            setConEsquina(true);
            dibujar(bboxDeEsquinas(ev.lngLat, ev.lngLat));
            return;
          }
          esquina.current = null;
          setConEsquina(false);
          const bbox = bboxDeEsquinas(a, ev.lngLat);
          dibujar(bbox);
          alMarcar.current?.(bbox);
        });
        m.on('mousemove', (ev) => {
          const a = esquina.current;
          if (!marcando.current || a === null) return;
          dibujar(bboxDeEsquinas(a, ev.lngLat));
        });
        m.on('moveend', () => alVista.current?.(bboxVisible(m)));
        dibujar(marcado.current);
        alVista.current?.(bboxVisible(m));
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
    const sueltos = agrupados?.puntos ?? [];
    void m.getSource<GeoJSONSource>('agrupados')?.setData({
      type: 'FeatureCollection',
      features: sueltos.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id },
      })),
    });
    void m.getSource<GeoJSONSource>('agrupados-lineas')?.setData({
      type: 'FeatureCollection',
      features: (agrupados?.lineas ?? [])
        .filter((l) => l.length > 1)
        .map((l) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: l.map(([a, b]) => [a, b]) },
          properties: {},
        })),
    });
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
      ...sueltos.map((p): [number, number] => [p.lon, p.lat]),
      ...capas.flatMap((c) => coordenadas(c.geometria.coordinates)),
    ];
    // Encuadrar solo cuando cambia el conjunto de lugares (elegir un marcador no mueve el mapa).
    const clave = todos.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join(';');
    if (todos.length > 0 && clave !== encuadrado.current) {
      encuadrado.current = clave;
      const limites = new maplibregl.LngLatBounds();
      for (const c of todos) limites.extend(c);
      m.fitBounds(limites, {
        padding: 48,
        maxZoom: capas.length > 0 || sueltos.length > 0 ? 18 : 15,
        duration: 0,
      });
    }
  }, [puntos, agrupados, capas, marcadores, listo]);

  // Modo dibujo: cursor en cruz; al salir de él se descarta la esquina a medio marcar.
  useEffect(() => {
    const m = mapa.current;
    if (!listo || m === null) return;
    m.getCanvas().style.cursor = marcarRectangulo ? 'crosshair' : '';
    if (!marcarRectangulo && esquina.current !== null) {
      esquina.current = null;
      setConEsquina(false);
    }
  }, [marcarRectangulo, listo]);

  // El borrador que llega por props (p. ej. «usar el área visible» o limpiar el formulario).
  useEffect(() => {
    const m = mapa.current;
    if (!listo || m === null || esquina.current !== null) return;
    void m.getSource<GeoJSONSource>('dibujo')?.setData({
      type: 'FeatureCollection',
      features:
        rectanguloMarcado === null
          ? []
          : [{ type: 'Feature', geometry: poligonoDeBbox(rectanguloMarcado), properties: {} }],
    });
  }, [rectanguloMarcado, listo]);

  const cancelarEsquina = () => {
    const m = mapa.current;
    esquina.current = null;
    setConEsquina(false);
    void m?.getSource<GeoJSONSource>('dibujo')?.setData({
      type: 'FeatureCollection',
      features:
        marcado.current === null
          ? []
          : [{ type: 'Feature', geometry: poligonoDeBbox(marcado.current), properties: {} }],
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={contenedor}
        style={{ height: alto }}
        className="w-full overflow-hidden rounded-md border border-linea"
        role="region"
        aria-label={etiqueta}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape' && esquina.current !== null) {
            ev.stopPropagation();
            cancelarEsquina();
          }
        }}
      />
      {marcarRectangulo ? (
        <p role="status" className="text-sm text-tinta-suave">
          {conEsquina
            ? 'Primera esquina fijada. Haga clic en la esquina opuesta (Escape para cancelar).'
            : 'Haga clic en una esquina del área que quiere marcar.'}
        </p>
      ) : null}
      {sinMapaBase ? (
        <p className="text-xs text-tinta-suave">
          Sin mapa base cargado: se muestran solo las estaciones. Cargue el archivo base.pmtiles en
          el servidor para ver el terreno.
        </p>
      ) : null}
    </div>
  );
};
