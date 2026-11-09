import { multiPoligonoSchema, type MultiPoligono } from '@campo/core';

type Posicion = [number, number];
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { leerEntradasZip, tieneFirmaZip } from '../../plataforma/xlsx.ts';

/**
 * Lectura de un KMZ o KML del proyecto (decisión del usuario, 2026-11-09). El archivo se valida
 * por su contenido: un KMZ pasa por el mismo lector ZIP con límites que las planillas (sin bombas
 * zip, CRC verificado, sin cifrado); un KML debe ser XML con `<kml`. No se usa un parser XML con
 * entidades: se rechaza `<!DOCTYPE`/`<!ENTITY` y se extraen solo los Placemark con `Polygon`
 * (en `MultiGeometry` también), con sus anillos exterior e interiores. Puntos, líneas y
 * superposiciones de imagen se ignoran y se informan.
 */

export const LIMITE_POLIGONOS = 500;
export const LIMITE_VERTICES = 200_000;

const noEsKmz = (detalle = 'El archivo no es un KMZ ni un KML válido.'): ProblemaHttp =>
  new ProblemaHttp(415, 'ARCHIVO_NO_KMZ', detalle);

const etiqueta = (nombre: string): string => `(?:\\w{1,40}:)?${nombre}`;
// Las expresiones se arman solo con nombres de etiqueta fijos de este archivo, nunca con datos.
const bloques = (xml: string, nombre: string): string[] =>
  // eslint-disable-next-line security/detect-non-literal-regexp -- nombre fijo (ver arriba).
  xml.match(new RegExp(`<${etiqueta(nombre)}\\b[^>]*>[\\s\\S]*?</${etiqueta(nombre)}>`, 'g')) ?? [];
const contenido = (xml: string, nombre: string): string | null => {
  // eslint-disable-next-line security/detect-non-literal-regexp -- nombre fijo (ver arriba).
  const m = new RegExp(`<${etiqueta(nombre)}\\b[^>]*>([\\s\\S]*?)</${etiqueta(nombre)}>`).exec(xml);
  return m?.[1] ?? null;
};

const texto = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** «lon,lat[,alt] lon,lat…» → anillo cerrado, o `null` si no es válido. */
const anillo = (coordenadas: string): Posicion[] | null => {
  const puntos: Posicion[] = [];
  for (const tupla of coordenadas.trim().split(/\s+/)) {
    if (tupla === '') continue;
    const [lon, lat] = tupla.split(',').map(Number);
    if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat))
      return null;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    puntos.push([lon, lat]);
  }
  const [primero] = puntos;
  const ultimo = puntos.at(-1);
  if (primero === undefined || ultimo === undefined) return null;
  if (primero[0] !== ultimo[0] || primero[1] !== ultimo[1]) puntos.push(primero);
  return puntos.length >= 4 ? puntos : null;
};

const anillosDe = (xml: string, borde: string): Posicion[][] | null => {
  const r: Posicion[][] = [];
  for (const b of bloques(xml, borde)) {
    const c = contenido(b, 'coordinates');
    const a = c === null ? null : anillo(c);
    if (a === null) return null;
    r.push(a);
  }
  return r;
};

export interface KmzLeido {
  readonly poligonos: { nombre: string; geometria: MultiPoligono }[];
  readonly ignorados: { nombre: string; motivo: string }[];
}

const kmlDe = (archivo: Buffer): string => {
  if (tieneFirmaZip(archivo)) {
    let entradas;
    try {
      entradas = leerEntradasZip(archivo);
    } catch (e) {
      if (e instanceof ProblemaHttp && e.estado === 413) throw e;
      throw noEsKmz();
    }
    const kml =
      entradas.find((e) => e.nombre.toLowerCase() === 'doc.kml') ??
      entradas.find((e) => e.nombre.toLowerCase().endsWith('.kml'));
    if (kml === undefined) throw noEsKmz('El KMZ no contiene ningún archivo .kml.');
    return kml.datos.toString('utf8');
  }
  return archivo.toString('utf8');
};

export const leerKmz = (archivo: Buffer): KmzLeido => {
  const xml = kmlDe(archivo).replace(/^\uFEFF/, '');
  if (!/<kml[\s>]/.test(xml) && !/:kml[\s>]/.test(xml)) throw noEsKmz();
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw noEsKmz('El KML no puede declarar DOCTYPE ni entidades.');

  const poligonos: KmzLeido['poligonos'] = [];
  const ignorados: KmzLeido['ignorados'] = [];
  let vertices = 0;
  for (const [i, pm] of bloques(xml, 'Placemark').entries()) {
    const nombre = texto(contenido(pm, 'name') ?? '') || `Polígono ${String(i + 1)}`;
    const partes = bloques(pm, 'Polygon');
    if (partes.length === 0) {
      ignorados.push({ nombre, motivo: 'No tiene polígono (punto, línea u otra geometría).' });
      continue;
    }
    const coordenadas: Posicion[][][] = [];
    let valido = true;
    for (const p of partes) {
      const exterior = anillosDe(p, 'outerBoundaryIs');
      const interiores = anillosDe(p, 'innerBoundaryIs');
      if (exterior?.length !== 1 || interiores === null) {
        valido = false;
        break;
      }
      coordenadas.push([...exterior, ...interiores]);
    }
    const g = { type: 'MultiPolygon' as const, coordinates: coordenadas };
    if (!valido || !multiPoligonoSchema.safeParse(g).success) {
      ignorados.push({ nombre, motivo: 'Sus coordenadas no forman un polígono válido.' });
      continue;
    }
    vertices += coordenadas.flat(2).length;
    if (poligonos.length >= LIMITE_POLIGONOS || vertices > LIMITE_VERTICES) {
      throw new ProblemaHttp(
        413,
        'KMZ_DEMASIADO_GRANDE',
        `El KMZ supera ${String(LIMITE_POLIGONOS)} polígonos o ${String(LIMITE_VERTICES)} vértices. Simplifíquelo antes de cargarlo.`,
      );
    }
    poligonos.push({ nombre: nombre.slice(0, 200), geometria: g });
  }
  if (bloques(xml, 'GroundOverlay').length > 0) {
    ignorados.push({
      nombre: 'Imágenes superpuestas',
      motivo: 'Las imágenes (GroundOverlay) no se cargan; solo los polígonos.',
    });
  }
  if (poligonos.length === 0) throw noEsKmz('El archivo no contiene ningún polígono.');
  return { poligonos, ignorados };
};
