import { z } from 'zod';
import {
  CLASES_APLICABILIDAD,
  condicionAplicabilidadSchema,
  configuracionMetodoSchema,
  campoSchema,
  TIPOS_CONTROL,
  TIPOS_GEOMETRIA,
  TIPOS_UNIDAD,
  type ClaseAplicabilidad,
  type ConfiguracionMetodo,
  type TipoValidacion,
  type Validacion,
} from './metodo.ts';

/**
 * Plantilla Excel de D01 (RF-W09): conversión entre una fila por método y `ConfiguracionMetodo`.
 *
 * La hoja `01_Config_Metodos` lleva primero las 19 columnas de D01 con sus encabezados exactos
 * (texto fuente, verbatim) y después las columnas «App · …» con los parámetros que el motor de
 * reglas evalúa. El texto libre de D01 nunca se interpreta para sacar números: los umbrales,
 * cantidades, horarios y tipos de control son columnas explícitas, y lo que no se puede leer es un
 * error de esa fila y columna (CLAUDE.md: la app no inventa umbrales). Las validaciones con su
 * tipo de control van en la hoja `Validaciones_App`, una fila por validación.
 *
 * Sin I/O: la API lee y escribe el .xlsx y entrega aquí celdas ya extraídas.
 */

export const HOJA_METODOS = '01_Config_Metodos';
export const HOJA_VALIDACIONES = 'Validaciones_App';
// La hoja de instrucciones se llama igual que en la plantilla A01 (`HOJA_INSTRUCCIONES`, programacion.ts).

/** Encabezados: los de D01 (verbatim) y los de la app. */
export const COL = {
  grupo: 'Grupo',
  metodo: 'Método',
  aplicacion: 'Aplicación / condición',
  unidad: 'Unidad operativa',
  esfuerzo: 'Esfuerzo estándar',
  za_ef: 'Regla ZA/EF',
  horario: 'Horario / duración',
  geometria: 'Georreferenciación / geometría en app',
  track: 'Track',
  fotos_contexto: 'Fotos de contexto / hábitat',
  fotos_metodologicas: 'Fotos de aplicación metodológica',
  campos: 'Campos mínimos a capturar',
  validaciones: 'Validaciones / alertas',
  vinculo: 'Reutilización / vínculo',
  estado: 'Estado',
  origen: 'Origen de la regla',
  clase: 'Clase de aplicabilidad provisional',
  asignacion: 'Asignación provisional a estaciones',
  pendiente: 'Pendiente para cierre definitivo',
  codigo: 'App · Código',
  tipo_unidad: 'App · Tipo de unidad',
  unidades_adicionales: 'App · Unidades adicionales',
  esfuerzo_cantidad: 'App · Esfuerzo: cantidad',
  esfuerzo_unidad: 'App · Esfuerzo: unidad',
  za_ef_cantidad: 'App · ZA/EF: cantidad',
  horario_ventanas: 'App · Horario: ventanas',
  tipo_geometria: 'App · Geometría',
  geometria_vinculo: 'App · Geometría: método vinculado',
  fotos_por_unidad: 'App · Fotos de contexto por unidad',
  fotos_cardinales: 'App · Fotos de contexto cardinales',
  fotos_reutiliza: 'App · Fotos de contexto: reutiliza método',
  fotos_metodologicas_min: 'App · Fotos metodológicas mínimas',
  condicion: 'App · Condición de aplicabilidad (JSON)',
  vinculo_metodos: 'App · Métodos vinculados',
  detalle: 'App · Formulario y detalle (JSON)',
} as const;

/** Las 19 columnas de D01 hoja `01_Config_Metodos`, en su orden. */
export const COLUMNAS_D01 = [
  COL.grupo,
  COL.metodo,
  COL.aplicacion,
  COL.unidad,
  COL.esfuerzo,
  COL.za_ef,
  COL.horario,
  COL.geometria,
  COL.track,
  COL.fotos_contexto,
  COL.fotos_metodologicas,
  COL.campos,
  COL.validaciones,
  COL.vinculo,
  COL.estado,
  COL.origen,
  COL.clase,
  COL.asignacion,
  COL.pendiente,
] as const;

export const COLUMNAS_APP = [
  COL.codigo,
  COL.tipo_unidad,
  COL.unidades_adicionales,
  COL.esfuerzo_cantidad,
  COL.esfuerzo_unidad,
  COL.za_ef_cantidad,
  COL.horario_ventanas,
  COL.tipo_geometria,
  COL.geometria_vinculo,
  COL.fotos_por_unidad,
  COL.fotos_cardinales,
  COL.fotos_reutiliza,
  COL.fotos_metodologicas_min,
  COL.condicion,
  COL.vinculo_metodos,
  COL.detalle,
] as const;

export const COLUMNAS_METODOS: readonly string[] = [...COLUMNAS_D01, ...COLUMNAS_APP];

export const COLV = {
  metodo: 'Código del método',
  tipo: 'Tipo de validación',
  control: 'Tipo de control',
  texto: 'Texto (D01)',
  valor: 'Valor',
  valor_za_ef: 'Valor ZA/EF',
  otros: 'Otros parámetros (JSON)',
} as const;

export const COLUMNAS_VALIDACIONES: readonly string[] = Object.values(COLV);

/**
 * Parámetros de cada tipo de validación que van en «Valor» y «Valor ZA/EF»; el resto, en «Otros
 * parámetros (JSON)». Un `Record` sobre el tipo obliga a cubrir todos los tipos de core.
 */
const PARAMETROS: Readonly<Record<TipoValidacion, readonly [string | null, string | null]>> = {
  cantidad_unidades: ['minimo', 'minimo_za_ef'],
  cantidad_registros: ['minimo', null],
  referencia_esfuerzo: [null, null],
  separacion_minima_m: ['metros', null],
  duracion_unidad_min: ['minutos', 'minutos_za_ef'],
  horario: [null, null],
  geometria: [null, null],
  track: [null, null],
  fotos_contexto: ['cantidad_por_unidad', null],
  fotos_metodologicas: ['minimo', null],
  campos_obligatorios: [null, null],
  confirmacion: ['cantidad', null],
  mensaje: [null, null],
  tiempo_efectivo: ['minutos', 'reducible_a_min'],
  parametros_tecnicos: [null, null],
  vinculo_unidad: [null, null],
};

export const TIPOS_VALIDACION = Object.keys(PARAMETROS) as TipoValidacion[];

export const ETIQUETA_CLASE: Readonly<Record<ClaseAplicabilidad, string>> = {
  todas: 'TODAS',
  condicional: 'CONDICIONAL',
  evento: 'EVENTO',
  atributo: 'ATRIBUTO',
  transversal: 'TRANSVERSAL',
};

const SI = 'Sí';
const NO = 'No';
const HEREDA = 'Hereda';

/** Valores cerrados por columna: la API los pone como listas de validación del Excel. */
export const LISTAS_METODOS: Readonly<Record<string, readonly string[]>> = {
  [COL.clase]: CLASES_APLICABILIDAD.map((c) => ETIQUETA_CLASE[c]),
  [COL.track]: [SI, NO, HEREDA],
  [COL.tipo_unidad]: TIPOS_UNIDAD,
  [COL.tipo_geometria]: TIPOS_GEOMETRIA,
  [COL.fotos_cardinales]: [SI, NO],
};
export const LISTAS_VALIDACIONES: Readonly<Record<string, readonly string[]>> = {
  [COLV.tipo]: TIPOS_VALIDACION,
  [COLV.control]: TIPOS_CONTROL,
};

// ── Tipos de la lectura ──

export type Celda = string | number | null;

export interface FilaLeida {
  /** Número de fila en la hoja (1 = encabezados). */
  readonly fila: number;
  readonly celdas: Readonly<Partial<Record<string, Celda>>>;
}

export interface ErrorCelda {
  readonly hoja: string;
  /** `null`: error del archivo, no de una fila. */
  readonly fila: number | null;
  readonly columna: string | null;
  readonly mensaje: string;
}

export interface MetodoLeido {
  readonly fila: number;
  readonly config: ConfiguracionMetodo;
}

export interface ResultadoLectura {
  readonly metodos: readonly MetodoLeido[];
  readonly errores: readonly ErrorCelda[];
}

export interface EspecialidadPlantilla {
  readonly codigo: string;
  readonly nombre: string;
}

// ── Exportar ──

const json = (v: unknown): string => JSON.stringify(v);

const detalleDe = (m: ConfiguracionMetodo) => ({
  campos_ejecucion: m.campos_ejecucion,
  campos: m.campos,
  registros: m.registros,
  geometria_detalle: m.geometria.detalle,
  ...(m.geometria.por_tipo === undefined ? {} : { geometria_por_tipo: m.geometria.por_tipo }),
  ...(m.fotos.contexto.por_tipo === undefined ? {} : { fotos_por_tipo: m.fotos.contexto.por_tipo }),
});

/** Una fila de `01_Config_Metodos` con la configuración de un método. */
export const metodoAFila = (
  m: ConfiguracionMetodo,
  nombreGrupo: string,
): Readonly<Record<string, Celda>> => ({
  [COL.grupo]: nombreGrupo,
  [COL.metodo]: m.nombre,
  [COL.aplicacion]: m.aplicacion.texto,
  [COL.unidad]: m.unidad.texto,
  [COL.esfuerzo]: m.esfuerzo.estandar?.texto ?? null,
  [COL.za_ef]: m.esfuerzo.za_ef?.texto ?? null,
  [COL.horario]: m.horario?.texto ?? null,
  [COL.geometria]: m.geometria.texto,
  [COL.track]: m.track ? SI : m.geometria.tipo === 'hereda' ? HEREDA : NO,
  [COL.fotos_contexto]: m.fotos.contexto.texto,
  [COL.fotos_metodologicas]: m.fotos.metodologicas.texto,
  [COL.campos]: m.fuente.campos ?? null,
  [COL.validaciones]: m.fuente.validaciones ?? null,
  [COL.vinculo]: m.vinculo?.texto ?? null,
  [COL.estado]: m.fuente.estado,
  [COL.origen]: m.fuente.origen,
  [COL.clase]: ETIQUETA_CLASE[m.clase],
  [COL.asignacion]: m.fuente.asignacion ?? null,
  [COL.pendiente]: m.fuente.pendiente,
  [COL.codigo]: m.codigo,
  [COL.tipo_unidad]: m.unidad.tipo,
  [COL.unidades_adicionales]:
    m.unidad.tipos_adicionales.length === 0 ? null : m.unidad.tipos_adicionales.join(', '),
  [COL.esfuerzo_cantidad]: m.esfuerzo.estandar?.cantidad ?? null,
  [COL.esfuerzo_unidad]: m.esfuerzo.estandar?.unidad ?? null,
  [COL.za_ef_cantidad]: m.esfuerzo.za_ef?.cantidad ?? null,
  [COL.horario_ventanas]:
    m.horario === null || m.horario.ventanas.length === 0
      ? null
      : m.horario.ventanas.map((v) => `${v.inicio}-${v.fin}`).join('; '),
  [COL.tipo_geometria]: m.geometria.tipo,
  [COL.geometria_vinculo]: m.geometria.vinculo_metodo,
  [COL.fotos_por_unidad]: m.fotos.contexto.cantidad_por_unidad,
  [COL.fotos_cardinales]: m.fotos.contexto.cardinales ? SI : NO,
  [COL.fotos_reutiliza]: m.fotos.contexto.reutiliza_metodo,
  [COL.fotos_metodologicas_min]: m.fotos.metodologicas.minimo,
  [COL.condicion]: m.aplicacion.condicion === null ? null : json(m.aplicacion.condicion),
  [COL.vinculo_metodos]:
    m.vinculo === null || m.vinculo.metodos.length === 0 ? null : m.vinculo.metodos.join(', '),
  [COL.detalle]: json(detalleDe(m)),
});

/** Filas de `Validaciones_App` de un método, en su orden. */
export const validacionesAFilas = (m: ConfiguracionMetodo): Readonly<Record<string, Celda>>[] =>
  m.validaciones.map((v) => {
    const [p, s] = PARAMETROS[v.tipo];
    const otros: Record<string, unknown> = {};
    let valor: Celda = null;
    let valorZa: Celda = null;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'tipo' || k === 'tipo_control' || k === 'texto' || x === undefined) continue;
      if (k === p) valor = typeof x === 'number' ? x : null;
      else if (k === s) valorZa = typeof x === 'number' ? x : null;
      else otros[k] = x;
    }
    return {
      [COLV.metodo]: m.codigo,
      [COLV.tipo]: v.tipo,
      [COLV.control]: v.tipo_control,
      [COLV.texto]: v.texto,
      [COLV.valor]: valor,
      [COLV.valor_za_ef]: valorZa,
      [COLV.otros]: Object.keys(otros).length === 0 ? null : json(otros),
    };
  });

// ── Importar ──

/** Mayúsculas, sin tildes ni espacios repetidos: para comparar «Grupo» y valores de lista. */
const normalizar = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

const textoDe = (c: Celda | undefined): string | null => {
  if (c === null || c === undefined) return null;
  const s = typeof c === 'number' ? String(c) : c.trim();
  return s === '' ? null : s;
};

const VENTANA = /^(\d{1,2}):([0-5]\d)\s*[-–]\s*(\d{1,2}):([0-5]\d)$/;

const ventanaDe = (t: string): { inicio: string; fin: string } | null => {
  const r = VENTANA.exec(t.trim());
  if (r === null) return null;
  const [, h1 = '', m1 = '', h2 = '', m2 = ''] = r;
  if (Number(h1) > 23 || Number(h2) > 23) return null;
  return { inicio: `${h1.padStart(2, '0')}:${m1}`, fin: `${h2.padStart(2, '0')}:${m2}` };
};

const detalleSchema = z.strictObject({
  campos_ejecucion: z.array(campoSchema).default([]),
  campos: z.array(campoSchema).default([]),
  registros: configuracionMetodoSchema.shape.registros.default(null),
  geometria_detalle: configuracionMetodoSchema.shape.geometria.shape.detalle.default(null),
  geometria_por_tipo: configuracionMetodoSchema.shape.geometria.shape.por_tipo,
  fotos_por_tipo: configuracionMetodoSchema.shape.fotos.shape.contexto.shape.por_tipo,
});

const objetoJson = z.record(z.string(), z.unknown());

const describirIssue = (i: z.core.$ZodIssue): string =>
  i.path.length === 0 ? i.message : `${i.path.map(String).join('.')}: ${i.message}`;

/** Ruta de `ConfiguracionMetodo` → columna de la hoja de métodos (prefijo más largo). */
const RUTAS: readonly (readonly [string, string])[] = [
  ['codigo', COL.codigo],
  ['nombre', COL.metodo],
  ['especialidad', COL.grupo],
  ['clase', COL.clase],
  ['aplicacion.texto', COL.aplicacion],
  ['aplicacion.condicion', COL.condicion],
  ['aplicacion', COL.condicion],
  ['unidad.tipo', COL.tipo_unidad],
  ['unidad.tipos_adicionales', COL.unidades_adicionales],
  ['unidad.texto', COL.unidad],
  ['esfuerzo.estandar.cantidad', COL.esfuerzo_cantidad],
  ['esfuerzo.estandar.unidad', COL.esfuerzo_unidad],
  ['esfuerzo.estandar', COL.esfuerzo],
  ['esfuerzo.za_ef.cantidad', COL.za_ef_cantidad],
  ['esfuerzo.za_ef', COL.za_ef],
  ['horario.ventanas', COL.horario_ventanas],
  ['horario', COL.horario],
  ['geometria.tipo', COL.tipo_geometria],
  ['geometria.texto', COL.geometria],
  ['geometria.vinculo_metodo', COL.geometria_vinculo],
  ['geometria', COL.detalle],
  ['track', COL.track],
  ['fotos.contexto.cantidad_por_unidad', COL.fotos_por_unidad],
  ['fotos.contexto.cardinales', COL.fotos_cardinales],
  ['fotos.contexto.reutiliza_metodo', COL.fotos_reutiliza],
  ['fotos.contexto.texto', COL.fotos_contexto],
  ['fotos.contexto', COL.detalle],
  ['fotos.metodologicas.minimo', COL.fotos_metodologicas_min],
  ['fotos.metodologicas.texto', COL.fotos_metodologicas],
  ['vinculo.metodos', COL.vinculo_metodos],
  ['vinculo', COL.vinculo],
  ['fuente.estado', COL.estado],
  ['fuente.origen', COL.origen],
  ['fuente.pendiente', COL.pendiente],
  ['fuente.campos', COL.campos],
  ['fuente.validaciones', COL.validaciones],
  ['fuente.asignacion', COL.asignacion],
  ['campos_ejecucion', COL.detalle],
  ['campos', COL.detalle],
  ['registros', COL.detalle],
];

const columnaDeRuta = (ruta: string): string | null => {
  let mejor: string | null = null;
  let largo = -1;
  for (const [prefijo, col] of RUTAS) {
    if ((ruta === prefijo || ruta.startsWith(`${prefijo}.`)) && prefijo.length > largo) {
      mejor = col;
      largo = prefijo.length;
    }
  }
  return mejor;
};

/** Lector de celdas de una fila que acumula errores por columna. */
const lectorDeFila = (hoja: string, f: FilaLeida, errores: ErrorCelda[]) => {
  const error = (columna: string | null, mensaje: string): void => {
    errores.push({ hoja, fila: f.fila, columna, mensaje });
  };
  const texto = (col: string): string | null => textoDe(f.celdas[col]);
  const requerido = (col: string): string => {
    const t = texto(col);
    if (t === null) error(col, 'Es obligatorio.');
    return t ?? '';
  };
  const numero = (col: string, entero = false): number | null => {
    const c = f.celdas[col];
    const t = textoDe(c);
    if (t === null) return null;
    const n = typeof c === 'number' ? c : Number(t.replace(',', '.'));
    if (!Number.isFinite(n)) {
      error(col, `Debe ser un número: «${t}».`);
      return null;
    }
    if (entero && !Number.isInteger(n)) {
      error(col, `Debe ser un número entero: «${t}».`);
      return null;
    }
    return n;
  };
  const deLista = <T extends string>(
    col: string,
    valores: readonly T[],
    etiqueta: (v: T) => string = (v) => v,
  ): T | null => {
    const t = texto(col);
    if (t === null) return null;
    const v = valores.find((x) => normalizar(etiqueta(x)) === normalizar(t));
    if (v === undefined) {
      error(col, `Valor no admitido: «${t}». Use uno de: ${valores.map(etiqueta).join(', ')}.`);
      return null;
    }
    return v;
  };
  const codigos = (col: string): string[] =>
    (texto(col) ?? '')
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s !== '');
  const deJson = <T>(col: string, schema: z.ZodType<T>): T | null => {
    const t = texto(col);
    if (t === null) return null;
    let crudo: unknown;
    try {
      crudo = JSON.parse(t);
    } catch {
      error(col, 'No es un JSON válido.');
      return null;
    }
    const r = schema.safeParse(crudo);
    if (!r.success) {
      error(col, r.error.issues.map(describirIssue).join('; '));
      return null;
    }
    return r.data;
  };
  return { error, texto, requerido, numero, deLista, codigos, deJson };
};

const SI_NO = [SI, NO] as const;

/** Convierte una fila de `Validaciones_App` en el objeto que valida `validacionSchema`. */
const leerValidacion = (
  f: FilaLeida,
  errores: ErrorCelda[],
): {
  objeto: Record<string, unknown>;
  p: string | null;
  s: string | null;
  conError: boolean;
} => {
  const antes = errores.length;
  const l = lectorDeFila(HOJA_VALIDACIONES, f, errores);
  const tipo = l.deLista(COLV.tipo, TIPOS_VALIDACION);
  if (l.texto(COLV.tipo) === null) l.error(COLV.tipo, 'Es obligatorio.');
  const control = l.deLista(COLV.control, TIPOS_CONTROL);
  if (l.texto(COLV.control) === null) l.error(COLV.control, 'Es obligatorio.');
  const texto = l.requerido(COLV.texto);
  const [p, s] = tipo === null ? [null, null] : PARAMETROS[tipo];
  const valor = l.numero(COLV.valor);
  const valorZa = l.numero(COLV.valor_za_ef);
  if (tipo !== null && p === null && valor !== null)
    l.error(COLV.valor, `El tipo «${tipo}» no usa «${COLV.valor}»: déjelo vacío.`);
  if (tipo !== null && s === null && valorZa !== null)
    l.error(COLV.valor_za_ef, `El tipo «${tipo}» no usa «${COLV.valor_za_ef}»: déjelo vacío.`);
  const otros = l.deJson(COLV.otros, objetoJson) ?? {};
  for (const k of ['tipo', 'tipo_control', 'texto', p, s]) {
    if (k !== null && k in otros)
      l.error(COLV.otros, `«${k}» va en su propia columna, no en «${COLV.otros}».`);
  }
  return {
    objeto: {
      ...otros,
      tipo,
      tipo_control: control,
      texto,
      ...(p === null ? {} : { [p]: valor }),
      ...(s === null ? {} : { [s]: valorZa }),
    },
    p,
    s,
    conError: errores.length > antes,
  };
};

const columnaDeValidacion = (clave: string | undefined, p: string | null, s: string | null) =>
  clave === undefined
    ? null
    : clave === 'tipo'
      ? COLV.tipo
      : clave === 'tipo_control'
        ? COLV.control
        : clave === 'texto'
          ? COLV.texto
          : clave === p
            ? COLV.valor
            : clave === s
              ? COLV.valor_za_ef
              : COLV.otros;

/**
 * Lee las filas de la plantilla y devuelve los métodos convertidos y los errores por fila y
 * columna. Un método con algún error no se devuelve.
 *
 * @param codigosConocidos códigos de otros métodos válidos como destino de un vínculo (los de la
 *   configuración vigente que el archivo no trae).
 */
export const leerPlantillaD01 = (
  entrada: { readonly metodos: readonly FilaLeida[]; readonly validaciones: readonly FilaLeida[] },
  especialidades: readonly EspecialidadPlantilla[],
  codigosConocidos: ReadonlySet<string> = new Set(),
): ResultadoLectura => {
  const errores: ErrorCelda[] = [];

  // Validaciones agrupadas por código de método, en el orden de la hoja.
  const validaciones = new Map<
    string,
    {
      fila: FilaLeida;
      objeto: Record<string, unknown>;
      p: string | null;
      s: string | null;
      conError: boolean;
    }[]
  >();
  const codigosEnHoja = new Set(
    entrada.metodos.flatMap((f) => {
      const c = textoDe(f.celdas[COL.codigo]);
      return c === null ? [] : [c];
    }),
  );
  for (const f of entrada.validaciones) {
    const codigo = textoDe(f.celdas[COLV.metodo]);
    if (codigo === null) {
      errores.push({
        hoja: HOJA_VALIDACIONES,
        fila: f.fila,
        columna: COLV.metodo,
        mensaje: 'Es obligatorio.',
      });
      continue;
    }
    if (!codigosEnHoja.has(codigo)) {
      errores.push({
        hoja: HOJA_VALIDACIONES,
        fila: f.fila,
        columna: COLV.metodo,
        mensaje: `No hay un método con el código «${codigo}» en la hoja ${HOJA_METODOS}.`,
      });
      continue;
    }
    const lista = validaciones.get(codigo) ?? [];
    lista.push({ fila: f, ...leerValidacion(f, errores) });
    validaciones.set(codigo, lista);
  }

  const metodos: MetodoLeido[] = [];
  const vistos = new Map<string, number>();
  for (const f of entrada.metodos) {
    const antes = errores.length;
    const l = lectorDeFila(HOJA_METODOS, f, errores);
    const codigo = l.requerido(COL.codigo);
    if (codigo !== '') {
      const previa = vistos.get(codigo);
      if (previa !== undefined)
        l.error(COL.codigo, `Código repetido: ya está en la fila ${String(previa)}.`);
      else vistos.set(codigo, f.fila);
    }

    const grupo = l.requerido(COL.grupo);
    const especialidad = especialidades.find(
      (e) => normalizar(e.nombre) === normalizar(grupo) || e.codigo === grupo,
    );
    if (grupo !== '' && especialidad === undefined)
      l.error(
        COL.grupo,
        `Grupo desconocido: «${grupo}». Use uno de: ${especialidades.map((e) => e.nombre).join(', ')}.`,
      );

    const clase = l.deLista(COL.clase, CLASES_APLICABILIDAD, (c) => ETIQUETA_CLASE[c]);
    if (l.texto(COL.clase) === null) l.error(COL.clase, 'Es obligatorio.');
    const tipoUnidad = l.deLista(COL.tipo_unidad, TIPOS_UNIDAD);
    if (l.texto(COL.tipo_unidad) === null) l.error(COL.tipo_unidad, 'Es obligatorio.');
    const adicionales = l.codigos(COL.unidades_adicionales);
    const tipoGeometria = l.deLista(COL.tipo_geometria, TIPOS_GEOMETRIA);
    if (l.texto(COL.tipo_geometria) === null) l.error(COL.tipo_geometria, 'Es obligatorio.');

    const trackTexto = l.deLista(COL.track, [SI, NO, HEREDA]);
    if (l.texto(COL.track) === null) l.error(COL.track, 'Es obligatorio.');
    if (trackTexto === HEREDA && tipoGeometria !== null && tipoGeometria !== 'hereda')
      l.error(COL.track, '«Hereda» solo corresponde a un método con geometría «hereda».');

    // Esfuerzo, ZA/EF, horario y vínculo: sin texto de D01 no hay regla (la app no inventa).
    const sinTexto = (colTexto: string, colesApp: readonly string[]): void => {
      for (const c of colesApp) {
        if (l.texto(c) !== null)
          l.error(c, `«${colTexto}» está vacío en D01: este parámetro no puede tener valor.`);
      }
    };
    const esfuerzoTexto = l.texto(COL.esfuerzo);
    const esfuerzoCantidad = l.numero(COL.esfuerzo_cantidad);
    let estandar: unknown = null;
    if (esfuerzoTexto === null)
      sinTexto(COL.esfuerzo, [COL.esfuerzo_cantidad, COL.esfuerzo_unidad]);
    else
      estandar = {
        cantidad: esfuerzoCantidad,
        unidad: l.requerido(COL.esfuerzo_unidad),
        texto: esfuerzoTexto,
      };
    const zaTexto = l.texto(COL.za_ef);
    const zaCantidad = l.numero(COL.za_ef_cantidad);
    let zaEf: unknown = null;
    if (zaTexto === null) sinTexto(COL.za_ef, [COL.za_ef_cantidad]);
    else zaEf = { cantidad: zaCantidad, texto: zaTexto };

    const horarioTexto = l.texto(COL.horario);
    let horario: unknown = null;
    if (horarioTexto === null) sinTexto(COL.horario, [COL.horario_ventanas]);
    else {
      const ventanas: { inicio: string; fin: string }[] = [];
      for (const t of l.codigos(COL.horario_ventanas)) {
        const v = ventanaDe(t);
        if (v === null)
          l.error(COL.horario_ventanas, `Ventana inválida: «${t}». Use HH:MM-HH:MM; HH:MM-HH:MM.`);
        else ventanas.push(v);
      }
      horario = { ventanas, texto: horarioTexto };
    }

    const vinculoTexto = l.texto(COL.vinculo);
    const vinculoMetodos = l.codigos(COL.vinculo_metodos);
    let vinculo: unknown = null;
    if (vinculoTexto === null) sinTexto(COL.vinculo, [COL.vinculo_metodos]);
    else vinculo = { texto: vinculoTexto, metodos: vinculoMetodos };

    const cardinales = l.deLista(COL.fotos_cardinales, SI_NO);
    if (l.texto(COL.fotos_cardinales) === null) l.error(COL.fotos_cardinales, 'Es obligatorio.');
    const fotosMin = l.numero(COL.fotos_metodologicas_min, true);
    if (l.texto(COL.fotos_metodologicas_min) === null)
      l.error(
        COL.fotos_metodologicas_min,
        'Es obligatorio (0 si D01 no exige fotos metodológicas).',
      );

    const condicion = l.deJson(COL.condicion, condicionAplicabilidadSchema);
    const detalle = l.deJson(COL.detalle, detalleSchema) ?? detalleSchema.parse({});

    const propias = validaciones.get(codigo) ?? [];
    const candidato = {
      codigo,
      nombre: l.requerido(COL.metodo),
      especialidad: especialidad?.codigo ?? '',
      clase,
      aplicacion: { texto: l.requerido(COL.aplicacion), condicion },
      unidad: { tipo: tipoUnidad, tipos_adicionales: adicionales, texto: l.texto(COL.unidad) },
      esfuerzo: { estandar, za_ef: zaEf },
      horario,
      geometria: {
        tipo: tipoGeometria,
        texto: l.requerido(COL.geometria),
        vinculo_metodo: l.texto(COL.geometria_vinculo),
        ...(detalle.geometria_por_tipo === undefined
          ? {}
          : { por_tipo: detalle.geometria_por_tipo }),
        detalle: detalle.geometria_detalle,
      },
      track: trackTexto === SI,
      fotos: {
        contexto: {
          cantidad_por_unidad: l.numero(COL.fotos_por_unidad, true),
          ...(detalle.fotos_por_tipo === undefined ? {} : { por_tipo: detalle.fotos_por_tipo }),
          cardinales: cardinales === SI,
          reutiliza_metodo: l.texto(COL.fotos_reutiliza),
          texto: l.requerido(COL.fotos_contexto),
        },
        metodologicas: { minimo: fotosMin ?? 0, texto: l.requerido(COL.fotos_metodologicas) },
      },
      campos_ejecucion: detalle.campos_ejecucion,
      campos: detalle.campos,
      registros: detalle.registros,
      validaciones: propias.map((v) => v.objeto),
      vinculo,
      fuente: {
        estado: l.requerido(COL.estado),
        origen: l.requerido(COL.origen),
        pendiente: l.requerido(COL.pendiente),
        // Textos fuente opcionales: vacío = ausente (como en la semilla).
        ...Object.fromEntries(
          (
            [
              ['campos', COL.campos],
              ['validaciones', COL.validaciones],
              ['asignacion', COL.asignacion],
            ] as const
          ).flatMap(([k, col]) => {
            const t = l.texto(col);
            return t === null ? [] : [[k, t]];
          }),
        ),
      },
    };
    if (clase === 'condicional' && condicion === null && l.texto(COL.condicion) === null)
      l.error(COL.condicion, 'Un método CONDICIONAL necesita su condición (o {"tipo":"manual"}).');
    if (tipoGeometria === 'vinculada' && l.texto(COL.geometria_vinculo) === null)
      l.error(COL.geometria_vinculo, 'La geometría «vinculada» necesita el método vinculado.');

    // Una validación con error descarta su método completo.
    if (errores.length > antes || propias.some((v) => v.conError)) continue;
    const r = configuracionMetodoSchema.safeParse(candidato);
    if (!r.success) {
      for (const i of r.error.issues) {
        const [primero, indice, clave] = i.path;
        if (primero === 'validaciones' && typeof indice === 'number') {
          const v = propias[indice];
          errores.push({
            hoja: HOJA_VALIDACIONES,
            fila: v?.fila.fila ?? null,
            columna: columnaDeValidacion(
              typeof clave === 'string' ? clave : undefined,
              v?.p ?? null,
              v?.s ?? null,
            ),
            mensaje: describirIssue({ ...i, path: i.path.slice(2) }),
          });
        } else {
          const ruta = i.path.map(String).join('.');
          const columna = columnaDeRuta(ruta);
          errores.push({
            hoja: HOJA_METODOS,
            fila: f.fila,
            columna,
            mensaje: columna === COL.detalle ? describirIssue(i) : i.message,
          });
        }
      }
      continue;
    }
    metodos.push({ fila: f.fila, config: r.data });
  }

  // Referencias a otros métodos: deben existir en el archivo o en la configuración vigente.
  const existentes = new Set([...codigosEnHoja, ...codigosConocidos]);
  const rechazados = new Set<number>();
  for (const { fila, config: m } of metodos) {
    const revisar = (col: string, hoja: string, filaError: number, codigo: string | null) => {
      if (codigo === null || existentes.has(codigo)) return;
      errores.push({
        hoja,
        fila: filaError,
        columna: col,
        mensaje: `Método desconocido: «${codigo}».`,
      });
      rechazados.add(fila);
    };
    revisar(COL.geometria_vinculo, HOJA_METODOS, fila, m.geometria.vinculo_metodo);
    revisar(COL.fotos_reutiliza, HOJA_METODOS, fila, m.fotos.contexto.reutiliza_metodo);
    for (const c of m.vinculo?.metodos ?? []) revisar(COL.vinculo_metodos, HOJA_METODOS, fila, c);
    const propias = validaciones.get(m.codigo) ?? [];
    m.validaciones.forEach((v: Validacion, i) => {
      if (v.tipo === 'vinculo_unidad')
        revisar(COLV.otros, HOJA_VALIDACIONES, propias[i]?.fila.fila ?? fila, v.metodo);
    });
  }
  return { metodos: metodos.filter((m) => !rechazados.has(m.fila)), errores };
};

// ── Diferencias ──

export interface CambioCampo {
  readonly campo: string;
  readonly antes: string;
  readonly despues: string;
}

/** Etiqueta legible de cada ruta (prefijo más largo); el resto de la ruta se agrega con «›». */
const ETIQUETAS: readonly (readonly [string, string])[] = [
  ['nombre', COL.metodo],
  ['especialidad', COL.grupo],
  ['clase', COL.clase],
  ['aplicacion.texto', COL.aplicacion],
  ['aplicacion.condicion', 'Condición de aplicabilidad'],
  ['unidad.tipo', 'Tipo de unidad'],
  ['unidad.tipos_adicionales', 'Unidades adicionales'],
  ['unidad.texto', COL.unidad],
  ['esfuerzo.estandar.cantidad', 'Esfuerzo estándar: cantidad'],
  ['esfuerzo.estandar.unidad', 'Esfuerzo estándar: unidad'],
  ['esfuerzo.estandar.texto', COL.esfuerzo],
  ['esfuerzo.estandar', COL.esfuerzo],
  ['esfuerzo.za_ef.cantidad', 'ZA/EF: cantidad'],
  ['esfuerzo.za_ef.texto', COL.za_ef],
  ['esfuerzo.za_ef', COL.za_ef],
  ['horario.ventanas', 'Horario: ventanas'],
  ['horario.texto', COL.horario],
  ['horario', COL.horario],
  ['geometria.tipo', 'Geometría'],
  ['geometria.texto', COL.geometria],
  ['geometria.vinculo_metodo', 'Geometría: método vinculado'],
  ['geometria.detalle', 'Geometría: detalle'],
  ['geometria.por_tipo', 'Geometría por tipo de unidad'],
  ['track', COL.track],
  ['fotos.contexto.cantidad_por_unidad', 'Fotos de contexto por unidad'],
  ['fotos.contexto.por_tipo', 'Fotos de contexto por tipo de unidad'],
  ['fotos.contexto.cardinales', 'Fotos de contexto cardinales'],
  ['fotos.contexto.reutiliza_metodo', 'Fotos de contexto: reutiliza método'],
  ['fotos.contexto.texto', COL.fotos_contexto],
  ['fotos.metodologicas.minimo', 'Fotos metodológicas mínimas'],
  ['fotos.metodologicas.texto', COL.fotos_metodologicas],
  ['campos_ejecucion', 'Campo de la ejecución'],
  ['campos', 'Campo de la unidad'],
  ['registros', 'Registros'],
  ['validaciones', 'Validación'],
  ['vinculo.texto', COL.vinculo],
  ['vinculo.metodos', 'Métodos vinculados'],
  ['vinculo', COL.vinculo],
  ['fuente.estado', COL.estado],
  ['fuente.origen', COL.origen],
  ['fuente.pendiente', COL.pendiente],
  ['fuente.campos', COL.campos],
  ['fuente.validaciones', COL.validaciones],
  ['fuente.asignacion', COL.asignacion],
];

const etiquetaDe = (ruta: string): string => {
  let mejor: readonly [string, string] | undefined;
  for (const e of ETIQUETAS) {
    if (
      (ruta === e[0] || ruta.startsWith(`${e[0]}.`) || ruta.startsWith(`${e[0]}[`)) &&
      e[0].length > (mejor?.[0].length ?? -1)
    )
      mejor = e;
  }
  if (mejor === undefined) return ruta.replaceAll('.', ' › ');
  const resto = ruta.slice(mejor[0].length).replace(/^\./, '');
  return resto === '' ? mejor[1] : `${mejor[1]} ${resto.replaceAll('.', ' › ')}`;
};

const valorLegible = (v: unknown): string =>
  v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);

const aplanar = (v: unknown, ruta: string, salida: Map<string, string>): void => {
  if (Array.isArray(v)) {
    if (v.length === 0 || v.every((x) => x === null || typeof x !== 'object')) {
      // Vacío = ausente: pasar de [] a una lista con elementos muestra solo los elementos.
      salida.set(ruta, v.length === 0 ? '—' : valorLegible(v));
      return;
    }
    v.forEach((x: unknown, i) => {
      const o = x !== null && typeof x === 'object' ? (x as Record<string, unknown>) : {};
      const id =
        typeof o['clave'] === 'string'
          ? o['clave']
          : typeof o['tipo'] === 'string'
            ? `${String(i + 1)} ${o['tipo']}`
            : String(i + 1);
      aplanar(x, `${ruta}[${id}]`, salida);
    });
    return;
  }
  if (v !== null && typeof v === 'object') {
    const entradas = Object.entries(v).filter(([, x]) => x !== undefined);
    if (entradas.length === 0) salida.set(ruta, '—');
    for (const [k, x] of entradas) aplanar(x, ruta === '' ? k : `${ruta}.${k}`, salida);
    return;
  }
  salida.set(ruta, valorLegible(v));
};

/** Diferencias campo a campo entre dos configuraciones del mismo método, con etiquetas legibles. */
export const diferenciasMetodo = (
  antes: ConfiguracionMetodo,
  despues: ConfiguracionMetodo,
): CambioCampo[] => {
  const a = new Map<string, string>();
  const d = new Map<string, string>();
  aplanar(antes, '', a);
  aplanar(despues, '', d);
  const cambios: CambioCampo[] = [];
  for (const ruta of new Set([...a.keys(), ...d.keys()])) {
    const x = a.get(ruta) ?? '—';
    const y = d.get(ruta) ?? '—';
    if (x !== y) cambios.push({ campo: etiquetaDe(ruta), antes: x, despues: y });
  }
  return cambios;
};
