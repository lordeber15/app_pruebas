import { z } from 'zod';
import {
  AID_AII,
  ESTADOS_FILA_CRONOGRAMA,
  TIPOS_ACTIVIDAD_CRONOGRAMA,
  type AidAii,
  type EstadoFilaCronograma,
  type TipoActividadCronograma,
} from '../estados.ts';
import type { CambioCronograma } from '../cronograma/cambios.ts';
import { normalizarZonaUtm } from './estacion.ts';
import { REGIONES, type Region } from './metodo.ts';

/**
 * Programación A01 cargada desde la web (RF-W09, decisión del usuario 2026-11-08): plantilla
 * Excel con las hojas y columnas de A01 (hoja 01 Programación y hoja 02 Actividades especiales),
 * o la misma tabla llenada en la web. Mismo esquema y misma validación en la web y en la API.
 *
 * Cada fila se valida aquí (valores de lista, fecha, estación y coordenadas); que la brigada y la
 * estación existan en el proyecto lo verifica la API. `compararProgramacion` decide qué es nuevo,
 * qué cambia y qué queda igual frente al cronograma vigente (o el borrador): nunca produce un
 * «eliminar» (RN-35); lo que no viene en el archivo se informa como «no incluida».
 */

// ── Hojas, columnas y valores admitidos (A01) ──────────────────────────────────

export const HOJA_PROGRAMACION = '01_Programacion';
export const HOJA_ACTIVIDADES_ESPECIALES = '02_Actividades_especiales';
export const HOJA_INSTRUCCIONES = 'Instrucciones';

export const HOJAS_PROGRAMACION = ['programacion', 'actividades_especiales'] as const;
export type HojaProgramacion = (typeof HOJAS_PROGRAMACION)[number];

/** Encabezados de A01 hoja 01_Programacion, en su orden. */
export const COLUMNAS_PROGRAMACION = [
  'Tipo programación',
  'Región',
  'Brigada',
  'Fecha TH',
  'Tipo actividad',
  'Estación',
  'Zona UTM',
  'Este',
  'Norte',
  'AID/AII',
  'UV preliminar',
  'ZA/EF',
  'Detalle operativo',
  'Estado',
] as const;

/** Encabezados de A01 hoja 02_Actividades_Especiales, en su orden. */
export const COLUMNAS_ACTIVIDADES_ESPECIALES = [
  'Actividad',
  'Brigada',
  'Fecha TH',
  'Tipo actividad',
  'Estación',
  'Zona UTM',
  'Este',
  'Norte',
  'AID/AII',
  'UV preliminar',
  'ZA/EF',
  'Detalle operativo',
  'Estado',
] as const;

export const CAMPOS_FILA_PROGRAMACION = [
  'tipo_programacion',
  'region',
  'actividad',
  'brigada',
  'fecha',
  'tipo_actividad',
  'estacion',
  'zona_utm',
  'este',
  'norte',
  'aid_aii',
  'uv',
  'za_ef',
  'detalle',
  'estado',
] as const;
export type CampoFilaProgramacion = (typeof CAMPOS_FILA_PROGRAMACION)[number];

/** Columna de A01 → campo de la fila. */
export const CAMPO_DE_COLUMNA: Readonly<Record<string, CampoFilaProgramacion>> = {
  'Tipo programación': 'tipo_programacion',
  Región: 'region',
  Actividad: 'actividad',
  Brigada: 'brigada',
  'Fecha TH': 'fecha',
  'Tipo actividad': 'tipo_actividad',
  Estación: 'estacion',
  'Zona UTM': 'zona_utm',
  Este: 'este',
  Norte: 'norte',
  'AID/AII': 'aid_aii',
  'UV preliminar': 'uv',
  'ZA/EF': 'za_ef',
  'Detalle operativo': 'detalle',
  Estado: 'estado',
};

/** Columnas de cada hoja. */
export const COLUMNAS_DE_HOJA: Readonly<Record<HojaProgramacion, readonly string[]>> = {
  programacion: COLUMNAS_PROGRAMACION,
  actividades_especiales: COLUMNAS_ACTIVIDADES_ESPECIALES,
};

/** Tipo de programación de A01 hoja 01 (la regular o la complementaria de cierre de brechas). */
export const TIPOS_PROGRAMACION_A01 = ['REGULAR', 'COMPLEMENTARIA'] as const;
export type TipoProgramacionA01 = (typeof TIPOS_PROGRAMACION_A01)[number];

/** Región de A01 hoja 01: las de D01 y «COMPLEMENTARIA» para la programación complementaria. */
export const REGIONES_PROGRAMACION = [...REGIONES, 'COMPLEMENTARIA'] as const;
export type RegionProgramacion = (typeof REGIONES_PROGRAMACION)[number];

/** Actividades especiales de A01 hoja 02 (programan nominalmente sus métodos de D01). */
export const ACTIVIDADES_ESPECIALES = ['EPÍFITAS', 'CÁMARAS TRAMPA'] as const;
export type ActividadEspecial = (typeof ACTIVIDADES_ESPECIALES)[number];

/** Texto de A01 para cada tipo de actividad del cronograma. */
export const ETIQUETA_TIPO_ACTIVIDAD_A01: Readonly<Record<TipoActividadCronograma, string>> = {
  estacion: 'ESTACIÓN',
  movilizacion: 'MOVILIZACIÓN',
  traslado: 'TRASLADO',
  desmovilizacion: 'DESMOVILIZACIÓN',
  feriado: 'FERIADO / NO OPERATIVO',
  procesamiento: 'PROCESAMIENTO',
  otro: 'OTRO',
};

/** Texto de A01 para el estado de la fila (A01 usa OK y PENDIENTE VALIDACIÓN). */
export const ETIQUETA_ESTADO_FILA_A01: Readonly<Record<EstadoFilaCronograma, string>> = {
  ok: 'OK',
  pendiente_validacion: 'PENDIENTE VALIDACIÓN',
  reprogramada: 'REPROGRAMADA',
  sujeta_a_decision: 'SUJETA A DECISIÓN',
};

/** A01 escribe «—» en ZA/EF cuando la estación no está en zona de amortiguamiento ni EF. */
export const SIN_ZA_EF = '—';

/** Filas máximas por carga (A01 completo tiene 183). */
export const FILAS_MAXIMAS_PROGRAMACION = 3_000;

// ── Normalización ─────────────────────────────────────────────────────────────

/** Mayúsculas, sin tildes, sin guiones bajos y con un solo espacio: para comparar etiquetas. */
export const normalizarEtiqueta = (valor: string): string =>
  valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

/** Código de estación para comparar (A01 conserva «EM-29 R» con su espacio). */
export const normalizarCodigoEstacion = (valor: string): string =>
  valor.replace(/\s+/g, ' ').trim().toUpperCase();

const buscarEtiqueta = <T extends string>(
  valor: string,
  opciones: readonly T[],
  etiquetas?: Readonly<Record<T, string>>,
): T | undefined => {
  const n = normalizarEtiqueta(valor);
  return opciones.find(
    (o) =>
      normalizarEtiqueta(o) === n ||
      (etiquetas !== undefined && normalizarEtiqueta(etiquetas[o]) === n),
  );
};

/** Encabezado de una hoja → campo (tolera tildes, mayúsculas y «Tipo de …»). */
export const campoDeEncabezado = (encabezado: string): CampoFilaProgramacion | undefined => {
  const n = normalizarEtiqueta(encabezado).replace(/ DE /g, ' ');
  return Object.entries(CAMPO_DE_COLUMNA).find(
    ([col]) => normalizarEtiqueta(col).replace(/ DE /g, ' ') === n,
  )?.[1];
};

/** Nombre de hoja → hoja de la programación (A01 escribe «02_Actividades_Especiales»). */
export const hojaDeNombre = (nombre: string): HojaProgramacion | undefined => {
  const n = normalizarEtiqueta(nombre);
  if (n === normalizarEtiqueta(HOJA_PROGRAMACION)) return 'programacion';
  if (n === normalizarEtiqueta(HOJA_ACTIVIDADES_ESPECIALES)) return 'actividades_especiales';
  return undefined;
};

// ── Fila de entrada (celdas del Excel o de la tabla de la web) ───────────────

const celda = z
  .union([z.string().max(1_000), z.number(), z.null()])
  .optional()
  .default(null);

/** Una fila tal como llega: celdas sin interpretar, con su hoja y su número de fila. */
export const filaProgramacionEntradaSchema = z.object({
  hoja: z.enum(HOJAS_PROGRAMACION),
  /** Número de fila en la hoja (en la web, la posición en la tabla). */
  fila: z.number().int().positive().max(1_000_000),
  tipo_programacion: celda,
  region: celda,
  actividad: celda,
  brigada: celda,
  fecha: celda,
  tipo_actividad: celda,
  estacion: celda,
  zona_utm: celda,
  este: celda,
  norte: celda,
  aid_aii: celda,
  uv: celda,
  za_ef: celda,
  detalle: celda,
  estado: celda,
});
export type FilaProgramacionEntrada = z.input<typeof filaProgramacionEntradaSchema>;
type Entrada = z.output<typeof filaProgramacionEntradaSchema>;

export const filasProgramacionSchema = z.object({
  filas: z.array(filaProgramacionEntradaSchema).min(1).max(FILAS_MAXIMAS_PROGRAMACION),
});

/** Fila validada y normalizada. */
export interface FilaProgramacion {
  readonly hoja: HojaProgramacion;
  readonly fila: number;
  readonly tipo_programacion: TipoProgramacionA01 | null;
  readonly region: RegionProgramacion | null;
  readonly actividad_especial: ActividadEspecial | null;
  /** Código o nombre de la brigada, tal como viene. */
  readonly brigada: string;
  /** AAAA-MM-DD. */
  readonly fecha: string;
  readonly tipo_actividad: TipoActividadCronograma;
  readonly estacion: string | null;
  readonly zona_utm: string | null;
  readonly este: number | null;
  readonly norte: number | null;
  readonly aid_aii: AidAii | null;
  readonly uv: string | null;
  readonly za_ef: string | null;
  readonly detalle: string | null;
  readonly estado_fila: EstadoFilaCronograma;
}

export interface ValidacionFila {
  /** `null` si la fila tiene errores. */
  readonly valor: FilaProgramacion | null;
  readonly errores: readonly string[];
}

const texto = (v: string | number | null): string | null => {
  if (v === null) return null;
  const s = (typeof v === 'number' ? String(v) : v).trim();
  return s === '' ? null : s;
};

const numero = (v: string | number | null): number | null | 'invalido' => {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'invalido';
  const s = v.trim();
  if (s === '') return null;
  // «789777,389» (coma decimal) también vale.
  const n = Number(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s);
  return Number.isFinite(n) ? n : 'invalido';
};

/** Fecha real (AAAA-MM-DD) o `null`. */
const fechaReal = (a: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(a, m - 1, d));
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  if (a < 2000 || a > 2100) return null;
  return t.toISOString().slice(0, 10);
};

/**
 * Fecha de una celda: AAAA-MM-DD, DD/MM/AAAA o número de serie de Excel (sistema 1900, la que
 * guarda una celda de fecha sin formato). `null` si no es una fecha válida.
 */
export const fechaDeCelda = (v: string | number | null): string | null => {
  if (v === null) return null;
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 1 || v > 2_958_465) return null;
    // Día 0 de Excel = 1899-12-30 (incluye el 29/02/1900 inexistente que Excel cuenta).
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  const s = v.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]|$)/.exec(s);
  if (iso !== null) return fechaReal(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy !== null) return fechaReal(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
};

const lista = (valores: readonly string[]): string => valores.join(', ');

/** ¿La fila está vacía? (se ignora: Excel deja filas en blanco al final). */
export const filaVacia = (e: FilaProgramacionEntrada): boolean =>
  CAMPOS_FILA_PROGRAMACION.every((c) => {
    const v = e[c];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });

/** Valida una fila con los valores admitidos de A01 y el modelo (mensajes con «usted»). */
export const validarFilaProgramacion = (entrada: FilaProgramacionEntrada): ValidacionFila => {
  const p = filaProgramacionEntradaSchema.safeParse(entrada);
  if (!p.success) return { valor: null, errores: ['La fila no tiene el formato esperado.'] };
  const e: Entrada = p.data;
  const errores: string[] = [];

  let tipoProgramacion: TipoProgramacionA01 | null = null;
  let region: RegionProgramacion | null = null;
  let actividad: ActividadEspecial | null = null;
  if (e.hoja === 'programacion') {
    const tp = texto(e.tipo_programacion);
    tipoProgramacion = tp === null ? null : (buscarEtiqueta(tp, TIPOS_PROGRAMACION_A01) ?? null);
    if (tipoProgramacion === null) {
      errores.push(`Tipo programación: elija ${lista(TIPOS_PROGRAMACION_A01)}.`);
    }
    const r = texto(e.region);
    region = r === null ? null : (buscarEtiqueta(r, REGIONES_PROGRAMACION) ?? null);
    if (region === null) errores.push(`Región: elija ${lista(REGIONES_PROGRAMACION)}.`);
  } else {
    const a = texto(e.actividad);
    actividad = a === null ? null : (buscarEtiqueta(a, ACTIVIDADES_ESPECIALES) ?? null);
    if (actividad === null) errores.push(`Actividad: elija ${lista(ACTIVIDADES_ESPECIALES)}.`);
  }

  const brigada = texto(e.brigada);
  if (brigada === null) errores.push('Brigada: indique la brigada.');
  else if (brigada.length > 100) errores.push('Brigada: el nombre es demasiado largo.');

  const fecha = fechaDeCelda(e.fecha);
  if (fecha === null) {
    errores.push(
      texto(e.fecha) === null
        ? 'Fecha TH: indique la fecha.'
        : 'Fecha TH: no es una fecha válida (use AAAA-MM-DD o DD/MM/AAAA).',
    );
  }

  const ta = texto(e.tipo_actividad);
  const tipoActividad =
    ta === null
      ? undefined
      : buscarEtiqueta(ta, TIPOS_ACTIVIDAD_CRONOGRAMA, ETIQUETA_TIPO_ACTIVIDAD_A01);
  if (tipoActividad === undefined) {
    errores.push(
      `Tipo actividad: elija ${lista(TIPOS_ACTIVIDAD_CRONOGRAMA.map((t) => ETIQUETA_TIPO_ACTIVIDAD_A01[t]))}.`,
    );
  }

  const es = texto(e.estado);
  const estado =
    es === null ? undefined : buscarEtiqueta(es, ESTADOS_FILA_CRONOGRAMA, ETIQUETA_ESTADO_FILA_A01);
  if (estado === undefined) {
    errores.push(
      `Estado: elija ${lista(ESTADOS_FILA_CRONOGRAMA.map((x) => ETIQUETA_ESTADO_FILA_A01[x]))}.`,
    );
  }

  const estacionTxt = texto(e.estacion);
  const estacion = estacionTxt === null ? null : normalizarCodigoEstacion(estacionTxt);
  let zona: string | null = null;
  let este: number | null = null;
  let norte: number | null = null;
  let aidAii: AidAii | null = null;
  let uv: string | null = null;
  let zaEf: string | null = null;
  if (tipoActividad === 'estacion' && estacion === null) {
    errores.push('Estación: una actividad de tipo ESTACIÓN indica su estación.');
  }
  if (tipoActividad !== undefined && tipoActividad !== 'estacion' && estacion !== null) {
    errores.push('Estación: solo las actividades de tipo ESTACIÓN llevan estación.');
  }
  if (estacion !== null && estacion.length > 40)
    errores.push('Estación: el código es demasiado largo.');
  if (tipoActividad === 'estacion') {
    const z0 = texto(e.zona_utm);
    zona = z0 === null ? null : normalizarZonaUtm(z0);
    if (z0 !== null && zona === null) errores.push('Zona UTM: no es válida (por ejemplo, 18 S).');
    const x = numero(e.este);
    const y = numero(e.norte);
    if (x === 'invalido' || (x !== null && (x < 100_000 || x > 900_000))) {
      errores.push('Este: debe ser un número entre 100 000 y 900 000 (UTM WGS 84).');
    } else este = x;
    if (y === 'invalido' || (y !== null && (y < 0 || y > 10_000_000))) {
      errores.push('Norte: debe ser un número entre 0 y 10 000 000 (UTM WGS 84).');
    } else norte = y;
    const conAlguna = z0 !== null || x !== null || y !== null;
    const completas = z0 !== null && x !== null && y !== null;
    if (conAlguna && !completas) {
      errores.push('Ubicación: indique juntas la Zona UTM, el Este y el Norte.');
    }
    const ai = texto(e.aid_aii);
    aidAii = ai === null ? null : (buscarEtiqueta(ai, AID_AII) ?? null);
    if (ai !== null && aidAii === null) errores.push(`AID/AII: elija ${lista(AID_AII)}.`);
    uv = texto(e.uv);
    if (uv !== null && uv.length > 200) errores.push('UV preliminar: el texto es demasiado largo.');
    const za = texto(e.za_ef);
    zaEf = za === null || za === SIN_ZA_EF || za === '-' ? null : za;
    if (zaEf !== null && zaEf.length > 200) errores.push('ZA/EF: el texto es demasiado largo.');
  }
  const detalle = texto(e.detalle);
  if (detalle !== null && detalle.length > 500) {
    errores.push('Detalle operativo: el texto es demasiado largo (máximo 500 caracteres).');
  }

  if (
    errores.length > 0 ||
    brigada === null ||
    fecha === null ||
    tipoActividad === undefined ||
    estado === undefined
  ) {
    return { valor: null, errores };
  }
  return {
    valor: {
      hoja: e.hoja,
      fila: e.fila,
      tipo_programacion: tipoProgramacion,
      region,
      actividad_especial: actividad,
      brigada,
      fecha,
      tipo_actividad: tipoActividad,
      estacion,
      zona_utm: zona,
      este,
      norte,
      aid_aii: aidAii,
      uv,
      za_ef: zaEf,
      detalle,
      estado_fila: estado,
    },
    errores: [],
  };
};

/** Región de una estación nueva a partir de la fila (solo hoja 01 y si es COSTA/SIERRA/SELVA). */
export const regionDeFila = (f: FilaProgramacion): Region | null =>
  REGIONES.find((r) => r === f.region) ?? null;

// ── Comparación con el cronograma vigente o el borrador (RN-35) ──────────────

/** Fila del archivo ya resuelta contra el proyecto (brigada y estación con su id o código). */
export interface FilaResuelta {
  /** Índice de la fila en la carga. */
  readonly indice: number;
  readonly brigada_id: string;
  readonly fecha: string;
  readonly tipo_actividad: TipoActividadCronograma;
  /** Código normalizado de la estación (puede ser nueva). */
  readonly estacion: string | null;
  readonly actividad_especial: string | null;
  readonly detalle: string | null;
  readonly estado_fila: EstadoFilaCronograma;
}

/** Fila existente del cronograma vigente (o del borrador). */
export interface FilaExistente {
  readonly id: string;
  readonly brigada_id: string;
  readonly fecha: string;
  readonly tipo_actividad: TipoActividadCronograma;
  readonly estacion: string | null;
  readonly actividad_especial: string | null;
  readonly detalle: string | null;
  readonly estado_fila: EstadoFilaCronograma;
}

export type AccionFilaProgramacion = 'nueva' | 'cambio' | 'sin_cambio';

export interface ComparacionFila {
  readonly indice: number;
  readonly accion: AccionFilaProgramacion;
  /** Fila existente que corresponde (cambio o sin cambio). */
  readonly item_id: string | null;
  /** Lo que cambia respecto de la fila existente. */
  readonly fecha?: { readonly antes: string; readonly despues: string };
  readonly brigada?: { readonly antes: string; readonly despues: string };
  readonly estado_fila?: {
    readonly antes: EstadoFilaCronograma;
    readonly despues: EstadoFilaCronograma;
  };
  /** El detalle operativo difiere: no se cambia por carga (no hay cambio de cronograma para eso). */
  readonly detalle_distinto: boolean;
}

export interface ComparacionProgramacion {
  readonly filas: readonly ComparacionFila[];
  /** Filas existentes que el archivo no incluye: se conservan tal cual (RN-35). */
  readonly no_incluidas: readonly string[];
}

const claveExacta = (f: FilaResuelta | FilaExistente): string =>
  JSON.stringify([
    f.actividad_especial,
    f.brigada_id,
    f.fecha,
    f.tipo_actividad,
    f.estacion,
    f.detalle,
    f.estado_fila,
  ]);

/**
 * Misma fila lógica: la estación (con su actividad especial) o, para las demás actividades,
 * la brigada, el tipo y el detalle (una movilización que cambia de fecha sigue siendo la misma).
 */
const claveLogica = (f: FilaResuelta | FilaExistente): string =>
  f.estacion !== null
    ? JSON.stringify(['e', f.actividad_especial, f.estacion])
    : JSON.stringify(['o', f.actividad_especial, f.brigada_id, f.tipo_actividad, f.detalle]);

const porFecha = <T extends { fecha: string }>(a: T, b: T): number =>
  a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0;

/**
 * Compara la carga con las filas existentes. Primero empareja las filas idénticas (sin cambio);
 * después, por fila lógica y en orden de fecha, las que cambian de fecha, brigada o estado; el
 * resto es nuevo. Nada se elimina: lo existente que no aparece queda en `no_incluidas`.
 */
export const compararProgramacion = (
  filas: readonly FilaResuelta[],
  existentes: readonly FilaExistente[],
): ComparacionProgramacion => {
  const libres = new Map<string, FilaExistente>(existentes.map((x) => [x.id, x]));
  const resultado = new Map<number, ComparacionFila>();

  // 1. Idénticas.
  const exactas = new Map<string, FilaExistente[]>();
  for (const x of [...existentes].sort(porFecha)) {
    const k = claveExacta(x);
    exactas.set(k, [...(exactas.get(k) ?? []), x]);
  }
  for (const f of filas) {
    const x = exactas.get(claveExacta(f))?.shift();
    if (x === undefined) continue;
    libres.delete(x.id);
    resultado.set(f.indice, {
      indice: f.indice,
      accion: 'sin_cambio',
      item_id: x.id,
      detalle_distinto: false,
    });
  }

  // 2. Misma fila lógica, en orden de fecha.
  const logicas = new Map<string, FilaExistente[]>();
  for (const x of [...libres.values()].sort(porFecha)) {
    const k = claveLogica(x);
    logicas.set(k, [...(logicas.get(k) ?? []), x]);
  }
  for (const f of [...filas].filter((y) => !resultado.has(y.indice)).sort(porFecha)) {
    const x = logicas.get(claveLogica(f))?.shift();
    if (x === undefined) {
      resultado.set(f.indice, {
        indice: f.indice,
        accion: 'nueva',
        item_id: null,
        detalle_distinto: false,
      });
      continue;
    }
    libres.delete(x.id);
    const cambiaFecha = x.fecha !== f.fecha;
    const cambiaBrigada = x.brigada_id !== f.brigada_id;
    const cambiaEstado = x.estado_fila !== f.estado_fila;
    const hayCambio = cambiaFecha || cambiaBrigada || cambiaEstado;
    resultado.set(f.indice, {
      indice: f.indice,
      accion: hayCambio ? 'cambio' : 'sin_cambio',
      item_id: x.id,
      ...(cambiaFecha ? { fecha: { antes: x.fecha, despues: f.fecha } } : {}),
      ...(cambiaBrigada ? { brigada: { antes: x.brigada_id, despues: f.brigada_id } } : {}),
      ...(cambiaEstado ? { estado_fila: { antes: x.estado_fila, despues: f.estado_fila } } : {}),
      detalle_distinto: x.detalle !== f.detalle,
    });
  }

  return {
    filas: filas.flatMap((f) => {
      const c = resultado.get(f.indice);
      return c === undefined ? [] : [c];
    }),
    no_incluidas: [...libres.keys()],
  };
};

/** Datos de la fila del archivo para armar la actividad agregada. */
export interface FilaParaCambio {
  readonly brigada_id: string;
  readonly fecha: string;
  readonly tipo_actividad: TipoActividadCronograma;
  readonly estacion_id: string | null;
  readonly detalle: string | null;
  readonly actividad_especial: string | null;
  readonly estado_fila: EstadoFilaCronograma;
}

/** Estados que una carga marca aunque la fila también se reprograme. */
const ESTADOS_QUE_SE_MARCAN: readonly EstadoFilaCronograma[] = [
  'pendiente_validacion',
  'sujeta_a_decision',
];

/**
 * Cambios de cronograma (solicitud de reprogramación, RN-35/RN-36) para una fila comparada con
 * el cronograma vigente: `agregar` si es nueva; `reprogramar` si cambia la fecha o la brigada
 * (queda «reprogramada»); `marcar` si cambia solo el estado, o si además de reprogramarse queda
 * pendiente de validación o sujeta a decisión. Nunca «eliminar».
 */
export const cambiosDeFilaComparada = (
  c: ComparacionFila,
  fila: FilaParaCambio,
  nuevoId: () => string,
): CambioCronograma[] => {
  if (c.accion === 'sin_cambio') return [];
  if (c.accion === 'nueva' || c.item_id === null) {
    return [
      {
        tipo: 'agregar',
        item: {
          id: nuevoId(),
          brigada_id: fila.brigada_id,
          fecha: fila.fecha,
          tipo_actividad: fila.tipo_actividad,
          estacion_id: fila.estacion_id,
          detalle: fila.detalle,
          actividad_especial: fila.actividad_especial,
          ...(fila.estado_fila === 'ok' ? {} : { estado_fila: fila.estado_fila }),
        },
      },
    ];
  }
  const cambios: CambioCronograma[] = [];
  const reprograma = c.fecha !== undefined || c.brigada !== undefined;
  if (reprograma) {
    cambios.push({
      tipo: 'reprogramar',
      item_id: c.item_id,
      fecha: fila.fecha,
      brigada_id: c.brigada === undefined ? null : fila.brigada_id,
    });
  }
  if (
    c.estado_fila !== undefined &&
    (!reprograma || ESTADOS_QUE_SE_MARCAN.includes(c.estado_fila.despues))
  ) {
    cambios.push({ tipo: 'marcar', item_id: c.item_id, estado_fila: c.estado_fila.despues });
  }
  return cambios;
};
