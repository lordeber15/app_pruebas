import { z } from 'zod';

/**
 * Polígonos del proyecto cargados por KMZ (RF-W02, RF-M05, D02 §11 «trabajar con KMZ/capas
 * entregadas por el proyecto»; la cartografía final es P-06). Decisión del usuario (2026-11-09):
 *
 * - Coordinación o JdP cargan un KMZ/KML en la web; cada Placemark con polígono queda como
 *   `poligono` de una `capa`.
 * - Un polígono se asigna a muchas estaciones (cada estación tiene a lo sumo uno).
 * - Una estación cuyas coordenadas (A01) caen **fuera** de su polígono se marca distinto en web y
 *   celular y genera una **alerta técnica** del sistema que cierran Coordinación o JdP.
 * - Una unidad ejecutada fuera del polígono de su estación es una **advertencia** (no bloquea):
 *   D01 no lo define como obligatorio (RN-31).
 *
 * Aquí solo están el contrato y la geometría pura (sin I/O): punto en polígono con huecos.
 */

/** [lon, lat] como en GeoJSON. */
export type Posicion = readonly [number, number];
/** Coordenadas de un MultiPolygon GeoJSON: polígonos → anillos (el primero exterior) → posiciones. */
export type CoordenadasMultiPoligono = readonly (readonly (readonly Posicion[])[])[];

const posicion = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export const multiPoligonoSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(posicion).min(4)).min(1)).min(1),
});
export type MultiPoligono = z.infer<typeof multiPoligonoSchema>;

/** Regla par-impar sobre un anillo (los bordes cuentan como dentro de forma no garantizada). */
const enAnillo = (lon: number, lat: number, anillo: readonly Posicion[]): boolean => {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const a = anillo[i];
    const b = anillo[j];
    if (a === undefined || b === undefined) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
};

/** ¿El punto cae dentro de alguno de los polígonos (y fuera de sus huecos)? */
export const puntoEnMultiPoligono = (
  punto: { readonly lat: number; readonly lon: number },
  coordenadas: CoordenadasMultiPoligono,
): boolean =>
  coordenadas.some((poligono) => {
    const [exterior, ...huecos] = poligono;
    if (exterior === undefined || !enAnillo(punto.lon, punto.lat, exterior)) return false;
    return !huecos.some((h) => enAnillo(punto.lon, punto.lat, h));
  });

// ── Contrato HTTP (API ↔ web y móvil) ──

export const asignarPoligonoSchema = z.object({
  estacion_ids: z.array(z.uuid()).min(1).max(2000),
  /** `null` quita la asignación. */
  poligono_id: z.uuid().nullable(),
});
export type AsignarPoligono = z.infer<typeof asignarPoligonoSchema>;

export interface PoligonoProyecto {
  readonly id: string;
  readonly capa_id: string;
  readonly capa_nombre: string;
  readonly nombre: string;
  readonly geometria: MultiPoligono;
  /** Estaciones asignadas y cuántas de ellas quedan fuera. */
  readonly estaciones: number;
  readonly fuera: number;
}

export interface CapaProyecto {
  readonly id: string;
  readonly nombre: string;
  readonly archivo_nombre: string;
  readonly poligonos: number;
  readonly creado_en: string;
  readonly cargado_por_nombre: string | null;
}

/** Estación con su polígono y si queda dentro (`null` sin polígono asignado). */
export interface EstacionEnPoligono {
  readonly estacion_id: string;
  readonly codigo: string;
  readonly lat: number;
  readonly lon: number;
  readonly poligono_id: string | null;
  readonly dentro: boolean | null;
}

/** Resultado de leer un KMZ antes de guardarlo (vista previa). */
export interface VistaPreviaKmz {
  readonly poligonos: readonly {
    readonly nombre: string;
    readonly geometria: MultiPoligono;
    /** Estaciones del proyecto que caen dentro, para asignarlas de una vez. */
    readonly estaciones_dentro: readonly { readonly id: string; readonly codigo: string }[];
  }[];
  /** Placemarks sin polígono (puntos, líneas) o con geometría inválida: se ignoran y se dicen. */
  readonly ignorados: readonly { readonly nombre: string; readonly motivo: string }[];
}
