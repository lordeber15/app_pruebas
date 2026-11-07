import type { ConfiguracionMetodo, TipoGeometria, TipoUnidad } from '../configuracion/metodo.ts';
import type { Coordenada, GeometriaCapturada } from './tipos.ts';

/** Radio medio terrestre (m) para la distancia de haversine. */
const RADIO_TIERRA_M = 6_371_008.8;
const rad = (g: number): number => (g * Math.PI) / 180;

/** Distancia geodésica aproximada (haversine) en metros, suficiente para separaciones de 10–250 m. */
export const distanciaM = (a: Coordenada, b: Coordenada): number => {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

const centroide = (puntos: readonly Coordenada[]): Coordenada | null => {
  if (puntos.length === 0) return null;
  const s = puntos.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), {
    lat: 0,
    lon: 0,
  });
  return { lat: s.lat / puntos.length, lon: s.lon / puntos.length };
};

/**
 * Punto que representa una unidad para medir separación entre unidades: el punto, el inicio de
 * una línea o el centroide de una parcela. D01 fija la separación mínima pero no cómo medirla
 * entre líneas; esta es la aproximación documentada.
 */
export const puntoRepresentativo = (g: GeometriaCapturada | null): Coordenada | null => {
  if (g === null) return null;
  switch (g.tipo) {
    case 'punto':
      return g.punto;
    case 'inicio_fin':
      return g.inicio;
    case 'vertices':
      return centroide(g.vertices);
    case 'parcela_forestal':
      return centroide(g.principal);
  }
};

/** Geometría que D01 exige a una unidad según su tipo (principal o adicional) (RN-30). */
export const geometriaRequerida = (
  metodo: Pick<ConfiguracionMetodo, 'unidad' | 'geometria'>,
  tipoUnidad: TipoUnidad,
): TipoGeometria | null => {
  const porTipo = metodo.geometria.por_tipo?.[tipoUnidad];
  if (porTipo !== undefined) return porTipo;
  return tipoUnidad === metodo.unidad.tipo ? metodo.geometria.tipo : null;
};

export type ProblemaGeometria =
  'SIN_GEOMETRIA' | 'TIPO_DISTINTO' | 'VERTICES_INSUFICIENTES' | 'SUBPARCELAS_INCOMPLETAS';

const verticesMinimos = (metodo: Pick<ConfiguracionMetodo, 'geometria'>): number =>
  metodo.geometria.detalle?.vertices_minimos ?? 3;

/**
 * Verifica que la geometría capturada sea exactamente la que D01 pide (E-04): punto; inicio + fin;
 * vértices (≥ mínimo); parcela forestal con su principal y cada grupo de subparcelas completo.
 * `hereda` y `vinculada` no se verifican aquí (RN-34: las resuelve el vínculo).
 */
export const verificarGeometria = (
  metodo: Pick<ConfiguracionMetodo, 'geometria'>,
  requerida: TipoGeometria,
  g: GeometriaCapturada | null,
): ProblemaGeometria | null => {
  switch (requerida) {
    case 'hereda':
    case 'vinculada':
      return null;
    case 'punto_opcional':
      return g === null || g.tipo === 'punto' ? null : 'TIPO_DISTINTO';
    case 'punto':
      if (g === null) return 'SIN_GEOMETRIA';
      return g.tipo === 'punto' ? null : 'TIPO_DISTINTO';
    case 'inicio_fin':
      if (g === null) return 'SIN_GEOMETRIA';
      return g.tipo === 'inicio_fin' ? null : 'TIPO_DISTINTO';
    case 'vertices': {
      if (g === null) return 'SIN_GEOMETRIA';
      if (g.tipo !== 'vertices') return 'TIPO_DISTINTO';
      return g.vertices.length >= verticesMinimos(metodo) ? null : 'VERTICES_INSUFICIENTES';
    }
    case 'parcela_forestal': {
      if (g === null) return 'SIN_GEOMETRIA';
      if (g.tipo !== 'parcela_forestal') return 'TIPO_DISTINTO';
      const min = verticesMinimos(metodo);
      if (g.principal.length < min) return 'VERTICES_INSUFICIENTES';
      for (const esperada of metodo.geometria.detalle?.subparcelas ?? []) {
        const completas = g.subparcelas.filter(
          (s) => s.tipo === esperada.tipo && s.vertices.length >= min,
        ).length;
        if (completas < esperada.cantidad) return 'SUBPARCELAS_INCOMPLETAS';
      }
      return null;
    }
  }
};

/** Menor distancia entre pares de puntos; `null` con menos de dos. */
export const separacionMinima = (
  puntos: readonly { readonly id: string; readonly punto: Coordenada }[],
): { readonly metros: number; readonly a: string; readonly b: string } | null => {
  let mejor: { metros: number; a: string; b: string } | null = null;
  for (let i = 0; i < puntos.length; i += 1) {
    for (let j = i + 1; j < puntos.length; j += 1) {
      const p = puntos[i];
      const q = puntos[j];
      if (p === undefined || q === undefined) continue;
      const d = distanciaM(p.punto, q.punto);
      if (mejor === null || d < mejor.metros) mejor = { metros: d, a: p.id, b: q.id };
    }
  }
  return mejor;
};
