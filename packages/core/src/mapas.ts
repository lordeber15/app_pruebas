import { z } from 'zod';

/**
 * Paquetes de mapa sin conexión (RF-M05, CA-08, V-10; bloque 8). El servidor recorta el mapa base
 * vectorial (PMTiles, ADR-005) a un área y el celular lo descarga para usarlo en modo avión.
 *
 * Dos orígenes:
 * - `brigada`: área automática con las estaciones de la brigada en el cronograma vigente más un
 *   margen (por defecto 5 km). Coordinación o JdP la generan; se regenera al cambiar el cronograma.
 * - `usuario`: rectángulo que marca un usuario (como en los mapas sin conexión de Google).
 *
 * Límites (aprobados por el usuario, 2026-11-08): zoom máximo 15 y ~150 MB por área, dentro de
 * V-10 (< 200 MB por proyecto). Son configurables por servidor; aquí solo están los valores por
 * defecto y las comprobaciones puras.
 */

export const ZOOM_MAXIMO_MAPA = 15;
export const TAMANO_MAXIMO_PAQUETE_MAPA = 150 * 1024 * 1024;
/** Margen alrededor de las estaciones para el área automática de una brigada. */
export const MARGEN_AREA_BRIGADA_KM = 5;
/** Lado máximo de un área marcada por un usuario: evita pedir recortes que nunca cabrían. */
export const LADO_MAXIMO_AREA_KM = 80;

export const ESTADOS_PAQUETE_MAPA = ['pendiente', 'generando', 'listo', 'error'] as const;
export type EstadoPaqueteMapa = (typeof ESTADOS_PAQUETE_MAPA)[number];

export const ORIGENES_PAQUETE_MAPA = ['brigada', 'usuario'] as const;
export type OrigenPaqueteMapa = (typeof ORIGENES_PAQUETE_MAPA)[number];

/** [oeste, sur, este, norte] en grados EPSG:4326. */
export const bboxSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([o, s, e, n]) => o < e && s < n, 'El área debe tener oeste < este y sur < norte.');
export type Bbox = z.infer<typeof bboxSchema>;

const KM_POR_GRADO_LAT = 111.32;

/** Ancho y alto aproximados del área en km (en la latitud media). */
export const ladosBboxKm = ([o, s, e, n]: Bbox): { ancho: number; alto: number } => {
  const latMedia = ((s + n) / 2) * (Math.PI / 180);
  return {
    ancho: (e - o) * KM_POR_GRADO_LAT * Math.cos(latMedia),
    alto: (n - s) * KM_POR_GRADO_LAT,
  };
};

/** Área que cubre todos los puntos más un margen en km; `null` sin puntos. */
export const bboxDePuntos = (
  puntos: readonly { readonly lat: number; readonly lon: number }[],
  margenKm: number = MARGEN_AREA_BRIGADA_KM,
): Bbox | null => {
  if (puntos.length === 0) return null;
  let o = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of puntos) {
    o = Math.min(o, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const dLat = margenKm / KM_POR_GRADO_LAT;
  const latMedia = ((s + n) / 2) * (Math.PI / 180);
  const dLon = margenKm / (KM_POR_GRADO_LAT * Math.max(Math.cos(latMedia), 0.01));
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  return [
    r(Math.max(o - dLon, -180)),
    r(Math.max(s - dLat, -90)),
    r(Math.min(e + dLon, 180)),
    r(Math.min(n + dLat, 90)),
  ];
};

/** Comprueba el tamaño de un área marcada por un usuario. */
export const validarAreaUsuario = (
  bbox: Bbox,
  ladoMaximoKm: number = LADO_MAXIMO_AREA_KM,
): { ok: true } | { ok: false; motivo: 'AREA_GRANDE'; mensaje: string } => {
  const { ancho, alto } = ladosBboxKm(bbox);
  if (ancho > ladoMaximoKm || alto > ladoMaximoKm)
    return {
      ok: false,
      motivo: 'AREA_GRANDE',
      mensaje: `El área mide ${ancho.toFixed(0)} × ${alto.toFixed(0)} km; el máximo es ${String(ladoMaximoKm)} km por lado. Marque un área más pequeña.`,
    };
  return { ok: true };
};

// ── Contrato HTTP (API ↔ web y móvil) ──

export const crearPaqueteMapaSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  bbox: bboxSchema,
  /** Brigada a la que pertenece el área; los usuarios de campo solo la suya. */
  brigada_id: z.uuid().optional(),
});
export type CrearPaqueteMapa = z.infer<typeof crearPaqueteMapaSchema>;

export const paqueteMapaSchema = z.object({
  id: z.uuid(),
  proyecto_id: z.uuid(),
  brigada_id: z.uuid().nullable(),
  brigada_nombre: z.string().nullable(),
  origen: z.enum(ORIGENES_PAQUETE_MAPA),
  nombre: z.string(),
  bbox: bboxSchema,
  zoom_max: z.number().int(),
  estado: z.enum(ESTADOS_PAQUETE_MAPA),
  /** Bytes del archivo generado; null hasta que esté listo. */
  tamano: z.number().int().nullable(),
  /** SHA-256 en hex del archivo generado, para verificarlo en el celular. */
  sha256: z.string().nullable(),
  /** Mensaje para el usuario si la generación falló (p. ej. supera el tamaño máximo). */
  error: z.string().nullable(),
  /** Aumenta cada vez que se regenera: el celular reemplaza su copia si es menor. */
  version: z.number().int(),
  generado_en: z.string().nullable(),
  creado_en: z.string(),
  solicitado_por_nombre: z.string().nullable(),
  /** Dispositivos que confirmaron tener la versión vigente descargada. */
  descargas: z.number().int(),
});
export type PaqueteMapa = z.infer<typeof paqueteMapaSchema>;

export const descargaPaqueteMapaSchema = z.object({
  /** URL firmada (≤ 15 min) del archivo .pmtiles. */
  url: z.string(),
  expira_en: z.string(),
  tamano: z.number().int(),
  sha256: z.string(),
  version: z.number().int(),
});
export type DescargaPaqueteMapa = z.infer<typeof descargaPaqueteMapaSchema>;
