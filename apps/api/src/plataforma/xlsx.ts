import { crc32, inflateRawSync } from 'node:zlib';
import { ProblemaHttp } from './errores.ts';

/**
 * Verificación de un .xlsx por su contenido, no por su extensión (CLAUDE.md, Archivos): firma
 * ZIP, estructura OOXML mínima y límites de descompresión (sin «bombas zip»). Cada entrada se
 * descomprime aquí con un tope y se verifica su CRC; ExcelJS solo lee el paquete ya verificado,
 * reempaquetado sin compresión.
 *
 * Además normaliza los XML con el espacio de nombres de SpreadsheetML con prefijo (`<x:row>`),
 * como el A01 original del cliente (generado con Open XML SDK): ExcelJS 4.4 no los reconoce y
 * Excel sí. Solo se quita el prefijo; el contenido no cambia.
 */

const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN = 0x06054b50;

/** Límites de una planilla de programación (A01 completo pesa ~150 KB descomprimido). */
export const LIMITES_XLSX = {
  entradas: 2_000,
  bytesPorEntrada: 50 * 1024 * 1024,
  bytesTotales: 50 * 1024 * 1024,
} as const;

const NS_SPREADSHEETML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const demasiadoGrande = (): ProblemaHttp =>
  new ProblemaHttp(
    413,
    'XLSX_DEMASIADO_GRANDE',
    'El libro es demasiado grande una vez descomprimido. Use la plantilla descargada desde la web.',
  );

const noEsXlsx = (
  detalle = 'El archivo no es un libro de Excel (.xlsx) válido. Use la plantilla descargada desde la web.',
): ProblemaHttp => new ProblemaHttp(415, 'ARCHIVO_NO_XLSX', detalle);

export interface EntradaZip {
  readonly nombre: string;
  readonly datos: Buffer;
}

/** ¿Empieza con la firma de un ZIP? (un .xlsx es un paquete ZIP). */
export const tieneFirmaZip = (b: Buffer): boolean =>
  b.length >= 4 && b.readUInt32LE(0) === FIRMA_LOCAL;

export const leerEntradasZip = (b: Buffer): EntradaZip[] => {
  if (!tieneFirmaZip(b) || b.length < 22) throw noEsXlsx();
  // Fin del directorio central: en los últimos 22 + 65 535 bytes (comentario máximo).
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) {
    if (b.readUInt32LE(i) === FIRMA_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw noEsXlsx();
  const total = b.readUInt16LE(fin + 10);
  const inicioCentral = b.readUInt32LE(fin + 16);
  if (total === 0xffff || inicioCentral === 0xffffffff) throw demasiadoGrande();
  if (total > LIMITES_XLSX.entradas) throw demasiadoGrande();

  const entradas: EntradaZip[] = [];
  let acumulado = 0;
  let p = inicioCentral;
  for (let n = 0; n < total; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== FIRMA_CENTRAL) throw noEsXlsx();
    const bandera = b.readUInt16LE(p + 8);
    const metodo = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const comprimido = b.readUInt32LE(p + 20);
    const tamano = b.readUInt32LE(p + 24);
    const largoNombre = b.readUInt16LE(p + 28);
    const largoExtra = b.readUInt16LE(p + 30);
    const largoComentario = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const nombre = b.toString('utf8', p + 46, p + 46 + largoNombre);
    p += 46 + largoNombre + largoExtra + largoComentario;
    // Cifrado o ZIP64: no es una planilla de programación.
    if ((bandera & 0x1) !== 0) throw noEsXlsx('El libro está protegido con contraseña.');
    if (comprimido === 0xffffffff || tamano === 0xffffffff) {
      throw demasiadoGrande();
    }
    if (tamano > LIMITES_XLSX.bytesPorEntrada) throw demasiadoGrande();
    acumulado += tamano;
    if (acumulado > LIMITES_XLSX.bytesTotales) throw demasiadoGrande();
    if (nombre.endsWith('/')) continue;
    if (local + 30 > b.length || b.readUInt32LE(local) !== FIRMA_LOCAL) throw noEsXlsx();
    const inicioDatos = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    if (inicioDatos + comprimido > b.length) throw noEsXlsx();
    const crudo = b.subarray(inicioDatos, inicioDatos + comprimido);
    let datos: Buffer;
    if (metodo === 0) datos = Buffer.from(crudo);
    else if (metodo === 8) {
      try {
        // El tope real es el tamaño declarado: un deflate que se infla más se corta aquí.
        datos = inflateRawSync(crudo, { maxOutputLength: Math.max(1, tamano) });
      } catch {
        throw noEsXlsx();
      }
    } else throw noEsXlsx();
    if (datos.length !== tamano || crc32(datos) !== crc) throw noEsXlsx();
    entradas.push({ nombre: nombre.replace(/^\/+/, ''), datos });
  }
  return entradas;
};

/** Quita el prefijo del espacio de nombres de SpreadsheetML (`x:`) en un XML. */
const sinPrefijoSpreadsheetMl = (xml: string): string => {
  const valor = `="${NS_SPREADSHEETML}"`;
  const i = xml.indexOf(valor);
  const inicio = i < 0 ? -1 : xml.lastIndexOf('xmlns:', i);
  if (inicio < 0) return xml;
  const prefijo = xml.slice(inicio + 'xmlns:'.length, i);
  // Ya hay un espacio de nombres por defecto, o el prefijo no es un nombre simple: no se toca.
  if (!/^[A-Za-z_][\w.-]{0,20}$/.test(prefijo) || xml.slice(0, 2_000).includes('xmlns="')) {
    return xml;
  }
  return xml
    .split(`</${prefijo}:`)
    .join('</')
    .split(`<${prefijo}:`)
    .join('<')
    .replace(`xmlns:${prefijo}=`, 'xmlns=');
};

const sinBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export const empaquetarSinCompresion = (entradas: readonly EntradaZip[]): Buffer => {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;
  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, 'utf8');
    const crc = crc32(e.datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(FIRMA_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.datos.length, 18);
    local.writeUInt32LE(e.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    partes.push(local, nombre, e.datos);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(FIRMA_CENTRAL, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.datos.length, 20);
    c.writeUInt32LE(e.datos.length, 24);
    c.writeUInt16LE(nombre.length, 28);
    c.writeUInt32LE(desplazamiento, 42);
    central.push(c, nombre);
    desplazamiento += 30 + nombre.length + e.datos.length;
  }
  const dir = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(FIRMA_FIN, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...partes, dir, fin]);
};

/**
 * Verifica que el contenido sea un libro .xlsx (ZIP con `[Content_Types].xml` y
 * `xl/workbook.xml`, sin macros) y lo devuelve normalizado y sin compresión para ExcelJS.
 * Lanza 415 si no lo es y 413 si descomprimido supera los límites (`LIMITES_XLSX`). Lo comparten
 * las cargas por Excel (programación A01, configuración D01).
 */
export const validarXlsx = (archivo: Buffer): Buffer => {
  const entradas = leerEntradasZip(archivo);
  const nombres = new Set(entradas.map((e) => e.nombre));
  if (!nombres.has('[Content_Types].xml') || !nombres.has('xl/workbook.xml')) throw noEsXlsx();
  if ([...nombres].some((n) => n.toLowerCase().endsWith('vbaproject.bin'))) {
    throw noEsXlsx('El libro contiene macros: guárdelo como .xlsx sin macros.');
  }
  const tipos =
    entradas.find((e) => e.nombre === '[Content_Types].xml')?.datos.toString('utf8') ?? '';
  if (!tipos.includes('spreadsheetml')) throw noEsXlsx();
  return empaquetarSinCompresion(
    entradas.map((e) =>
      e.nombre.endsWith('.xml') || e.nombre.endsWith('.rels')
        ? {
            nombre: e.nombre,
            datos: Buffer.from(sinPrefijoSpreadsheetMl(sinBom(e.datos.toString('utf8'))), 'utf8'),
          }
        : e,
    ),
  );
};

/** Nombre del archivo enviado en la cabecera `x-nombre-archivo` (codificado como URI); solo para el historial. */
export const nombreArchivoDeCabecera = (valor: string | undefined): string | null => {
  if (valor === undefined || valor === '') return null;
  let n: string;
  try {
    n = decodeURIComponent(valor);
  } catch {
    n = valor;
  }
  // eslint-disable-next-line no-control-regex -- se quitan caracteres de control del nombre.
  const sinControl = n.replace(/[\\/\u0000-\u001f]/g, '_');
  const limpio = sinControl.trim().slice(0, 255);
  return limpio === '' ? null : limpio;
};
