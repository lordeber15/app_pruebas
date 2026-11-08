import { z } from 'zod';
import { AID_AII } from '../estados.ts';
import { REGIONES } from './metodo.ts';

/**
 * Estación de muestreo con sus atributos espaciales (A01 hoja 01, RN-29). La crean o corrigen
 * Coordinación y JdP desde la web; nunca se piden al especialista. Mismo esquema en la web y en
 * la API.
 *
 * Las coordenadas llegan en UTM (zona, Este, Norte, WGS 84) como en A01; la base las convierte a
 * EPSG:4326 al guardar y conserva las originales como atributo.
 */

const ZONA_UTM = /^(\d{1,2})\s?([NS])$/i;

/**
 * Normaliza la zona UTM al formato de A01 («17 S»). Acepta «17S», «17 s» o «17 S». `null` si no
 * es una zona válida (1 a 60, hemisferio N o S).
 */
export const normalizarZonaUtm = (valor: string): string | null => {
  const m = ZONA_UTM.exec(valor.trim());
  if (m === null) return null;
  const zona = Number(m[1]);
  if (zona < 1 || zona > 60) return null;
  return `${String(zona)} ${(m[2] ?? '').toUpperCase()}`;
};

/** SRID EPSG de WGS 84 / UTM para una zona («18 S» → 32718; «18 N» → 32618). */
export const sridDeZonaUtm = (valor: string): number | null => {
  const z = normalizarZonaUtm(valor);
  if (z === null) return null;
  const [n, h] = z.split(' ');
  return (h === 'S' ? 32700 : 32600) + Number(n);
};

const texto = (max: number) => z.string().trim().min(1).max(max);
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v === '' ? null : v));

const zonaUtm = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizarZonaUtm(v);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: 'Zona UTM inválida: use, por ejemplo, 18S.' });
      return z.NEVER;
    }
    return n;
  });

/** Datos de una estación nueva (Coordinación o JdP, desde la web). */
export const estacionNuevaSchema = z.object({
  codigo: texto(40),
  zona_utm: zonaUtm,
  // Rango del falso Este y del Norte en el hemisferio sur (WGS 84 / UTM).
  este: z.number().min(100_000).max(900_000),
  norte: z.number().min(0).max(10_000_000),
  aid_aii: z.enum(AID_AII),
  uv: texto(200),
  /** Zona de amortiguamiento o ecosistema frágil; `null` si no aplica. */
  za_ef: opcional(200),
  /** Necesaria para evaluar la aplicabilidad de los métodos CONDICIONAL (RN-28). */
  region: z.enum(REGIONES).nullable(),
});
export type EstacionNueva = z.infer<typeof estacionNuevaSchema>;
export type EstacionNuevaEntrada = z.input<typeof estacionNuevaSchema>;

/** Corrección de atributos: cada campo es opcional; la estación nunca se borra. */
export const estacionCambioSchema = estacionNuevaSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No hay cambios.' })
  .refine(
    (v) =>
      (v.zona_utm === undefined && v.este === undefined && v.norte === undefined) ||
      (v.zona_utm !== undefined && v.este !== undefined && v.norte !== undefined),
    { message: 'La ubicación se corrige completa: zona UTM, Este y Norte.' },
  );
export type EstacionCambio = z.infer<typeof estacionCambioSchema>;
