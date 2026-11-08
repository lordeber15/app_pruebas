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

const hayMapaBase = async (): Promise<boolean> => {
  try {
    const r = await fetch('/mapa/base.pmtiles', { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').includes('octet-stream');
  } catch {
    return false;
  }
};

export const Mapa = ({
  puntos,
  alElegir,
  alto = '32rem',
}: {
  puntos: readonly PuntoMapa[];
  alElegir?: (id: string) => void;
  alto?: string;
}) => {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const [sinMapaBase, setSinMapaBase] = useState(false);
  const [listo, setListo] = useState(false);
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
    if (puntos.length > 0) {
      const limites = new maplibregl.LngLatBounds();
      for (const p of puntos) limites.extend([p.lon, p.lat]);
      m.fitBounds(limites, { padding: 48, maxZoom: 15, duration: 0 });
    }
  }, [puntos, listo]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={contenedor}
        style={{ height: alto }}
        className="w-full overflow-hidden rounded-md border border-linea"
        role="region"
        aria-label="Mapa de estaciones"
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
