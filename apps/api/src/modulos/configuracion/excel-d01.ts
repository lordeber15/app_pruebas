import {
  COL,
  COLUMNAS_APP,
  COLUMNAS_D01,
  COLUMNAS_METODOS,
  COLUMNAS_VALIDACIONES,
  COLV,
  HOJA_INSTRUCCIONES,
  HOJA_METODOS,
  HOJA_VALIDACIONES,
  LISTAS_METODOS,
  LISTAS_VALIDACIONES,
  metodoAFila,
  validacionesAFilas,
  type Celda,
  type ConfiguracionMetodo,
  type EspecialidadPlantilla,
  type FilaLeida,
} from '@campo/core';
import ExcelJS from 'exceljs';
import { ProblemaHttp } from '../../plataforma/errores.ts';

/**
 * Lectura y escritura del .xlsx de la plantilla D01 (RF-W09) con ExcelJS. La conversión de cada
 * fila a `ConfiguracionMetodo` vive en core (`plantilla-d01.ts`); aquí solo hay celdas.
 */

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HOJA_LISTAS = 'Listas';
/** Filas con listas desplegables (D01 tiene 33 métodos y unas 150 validaciones). */
const FILAS_CON_LISTA = 400;

const AYUDA_APP: Readonly<Record<string, string>> = {
  [COL.codigo]:
    'Identificador estable del método: especialidad.metodo, en minúsculas y sin tildes.',
  [COL.tipo_unidad]: 'Unidad operativa que registra la app (lista).',
  [COL.unidades_adicionales]: 'Otros tipos de unidad del método, separados por comas.',
  [COL.esfuerzo_cantidad]:
    'Número de unidades del esfuerzo estándar. Vacío si D01 no da una cantidad. Exige texto en «Esfuerzo estándar».',
  [COL.esfuerzo_unidad]:
    'Unidad del esfuerzo (p. ej. «transectos»). Obligatoria si hay texto de esfuerzo.',
  [COL.za_ef_cantidad]: 'Cantidad en ZA/EF. Exige texto en «Regla ZA/EF».',
  [COL.horario_ventanas]:
    'Ventanas HH:MM-HH:MM separadas por «;». Exige texto en «Horario / duración».',
  [COL.tipo_geometria]:
    'Geometría que captura la app (lista). RN-30: nunca una geometría genérica.',
  [COL.geometria_vinculo]: 'Código del método cuya geometría se reutiliza (geometría «vinculada»).',
  [COL.fotos_por_unidad]: 'Fotos de contexto por unidad (entero). Vacío si D01 no fija cantidad.',
  [COL.fotos_cardinales]: '¿Las fotos de contexto son cardinales N-S-E-O? (Sí/No).',
  [COL.fotos_reutiliza]: 'Código del método cuyas fotos de contexto se reutilizan (RN-34).',
  [COL.fotos_metodologicas_min]:
    'Mínimo de fotos metodológicas por estación/método (0 si no exige).',
  [COL.condicion]:
    'Solo CONDICIONAL: condición evaluable con A01, en JSON. Ej.: {"tipo":"region","regiones":["SELVA"]} o {"tipo":"manual"}.',
  [COL.vinculo_metodos]:
    'Códigos de los métodos vinculados, separados por comas. Exige texto en «Reutilización / vínculo».',
  [COL.detalle]:
    'Formulario y detalle en JSON: campos_ejecucion, campos, registros, geometria_detalle y, si aplica, geometria_por_tipo y fotos_por_tipo.',
};

const AYUDA_VALIDACION: Readonly<Record<string, string>> = {
  [COLV.metodo]: 'Código del método («App · Código» de la hoja 01_Config_Metodos).',
  [COLV.tipo]: 'Tipo de validación que evalúa el motor de reglas (lista).',
  [COLV.control]: 'Tipo de control (RN-31): solo «obligatorio» bloquea o genera incumplimiento.',
  [COLV.texto]: 'Texto de D01 que origina la validación.',
  [COLV.valor]: 'Umbral principal: mínimo, metros, minutos o cantidad, según el tipo.',
  [COLV.valor_za_ef]: 'Umbral en ZA/EF cuando el tipo lo distingue (vacío si no aplica).',
  [COLV.otros]: 'Demás parámetros del tipo, en JSON (p. ej. ventanas, por_region, metodo).',
};

const columnaExcel = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

const ESTILO_D01: Partial<ExcelJS.Fill> = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EFE6' },
};
const ESTILO_APP: Partial<ExcelJS.Fill> = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF4E9D2' },
};

/** Hoja con encabezados, filas, formato de texto y listas desplegables desde la hoja «Listas». */
const llenarHoja = (
  ws: ExcelJS.Worksheet,
  columnas: readonly string[],
  filas: readonly Readonly<Record<string, Celda>>[],
  listas: Readonly<Record<string, readonly string[]>>,
  rangoLista: ReadonlyMap<string, string>,
  ayuda: Readonly<Record<string, string>>,
  esApp: (col: string) => boolean,
): void => {
  ws.columns = columnas.map((c) => ({
    header: c,
    key: c,
    width: c.includes('JSON') ? 60 : 28,
    // Texto: Excel no convierte «06:00-10:00» ni códigos en fechas o números.
    style: { numFmt: '@', alignment: { wrapText: true, vertical: 'top' } },
  }));
  const encabezado = ws.getRow(1);
  encabezado.font = { bold: true };
  columnas.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1);
    celda.fill = (esApp(c) ? ESTILO_APP : ESTILO_D01) as ExcelJS.Fill;
    const nota = ayuda[c];
    if (nota !== undefined) celda.note = nota;
  });
  for (const f of filas) ws.addRow(columnas.map((c) => f[c] ?? null));
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  columnas.forEach((c, i) => {
    const valores = listas[c];
    const rango = rangoLista.get(c);
    if (valores === undefined || rango === undefined) return;
    for (let r = 2; r <= Math.max(FILAS_CON_LISTA, filas.length + 50); r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [rango],
        showErrorMessage: true,
        errorTitle: 'Valor no admitido',
        error: `Use un valor de la lista: ${valores.join(', ')}.`.slice(0, 255),
      };
    }
  });
};

export interface DatosPlantilla {
  readonly especialidades: readonly EspecialidadPlantilla[];
  /** `null`: plantilla vacía. */
  readonly vigente: {
    readonly numero: number;
    readonly metodos: readonly ConfiguracionMetodo[];
  } | null;
}

/** Libro .xlsx de la plantilla: métodos, validaciones, instrucciones y listas. */
export const escribirPlantillaD01 = async (datos: DatosPlantilla): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Plataforma de campo';
  wb.created = new Date();

  const nombres = new Map(datos.especialidades.map((e) => [e.codigo, e.nombre]));
  const metodos = datos.vigente?.metodos ?? [];
  const filasMetodos = metodos.map((m) =>
    metodoAFila(m, nombres.get(m.especialidad) ?? m.especialidad),
  );
  const filasValidaciones = metodos.flatMap(validacionesAFilas);

  const instrucciones = wb.addWorksheet(HOJA_INSTRUCCIONES);
  const wsMetodos = wb.addWorksheet(HOJA_METODOS);
  const wsValidaciones = wb.addWorksheet(HOJA_VALIDACIONES);
  const wsListas = wb.addWorksheet(HOJA_LISTAS, { state: 'hidden' });

  // Listas de valores cerrados (D01 y core), referenciadas por las celdas con desplegable.
  const todas: [string, readonly string[]][] = [
    ...Object.entries(LISTAS_METODOS),
    ...Object.entries(LISTAS_VALIDACIONES),
    [COL.grupo, datos.especialidades.map((e) => e.nombre)],
  ];
  const rango = new Map<string, string>();
  todas.forEach(([col, valores], i) => {
    const letra = columnaExcel(i + 1);
    wsListas.getCell(1, i + 1).value = col;
    valores.forEach((v, j) => {
      wsListas.getCell(j + 2, i + 1).value = v;
    });
    if (valores.length > 0)
      rango.set(col, `${HOJA_LISTAS}!$${letra}$2:$${letra}$${String(valores.length + 1)}`);
  });
  const listasMetodos = {
    ...LISTAS_METODOS,
    [COL.grupo]: datos.especialidades.map((e) => e.nombre),
  };
  const esApp = (c: string) => (COLUMNAS_APP as readonly string[]).includes(c);
  llenarHoja(wsMetodos, COLUMNAS_METODOS, filasMetodos, listasMetodos, rango, AYUDA_APP, esApp);
  llenarHoja(
    wsValidaciones,
    COLUMNAS_VALIDACIONES,
    filasValidaciones,
    LISTAS_VALIDACIONES,
    rango,
    AYUDA_VALIDACION,
    (c) => c !== COLV.texto,
  );

  instrucciones.columns = [{ width: 34 }, { width: 110 }];
  const lineas: [string, string][] = [
    [
      'Plantilla D01 · Configuración por método',
      datos.vigente === null
        ? 'Plantilla vacía.'
        : `Versión vigente exportada: ${String(datos.vigente.numero)}.`,
    ],
    [
      'Para qué sirve',
      'Cargar o actualizar la configuración por método (D01) del proyecto desde la web (RF-W09).',
    ],
    [
      'Cómo se usa',
      '1) Descargue la plantilla con la configuración vigente. 2) Edite las filas. 3) Súbala en «Configuración por método (D01)». 4) Revise la vista previa: métodos nuevos, cambios campo a campo y errores por fila y columna. 5) Aplique con un motivo.',
    ],
    [
      'Versiones',
      'Aplicar crea una versión nueva; la anterior queda como histórica y no se modifica. Las ejecuciones ya registradas conservan la versión con la que se abrieron.',
    ],
    [
      'Métodos que no vienen en el archivo',
      'Se conservan sin cambios en la versión nueva. Esta plantilla no elimina métodos.',
    ],
    [
      `Hoja ${HOJA_METODOS}`,
      `Una fila por método. Las primeras ${String(COLUMNAS_D01.length)} columnas (fondo verde) son las de D01 con sus encabezados exactos: texto fuente que se guarda para trazabilidad y no se interpreta. Las columnas «App · …» (fondo ocre) son los parámetros que la app evalúa: la app no saca números del texto libre ni inventa umbrales.`,
    ],
    [
      'Reglas de coherencia',
      'Si «Esfuerzo estándar», «Regla ZA/EF», «Horario / duración» o «Reutilización / vínculo» están vacíos, sus parámetros «App · …» también deben estarlo. Un CONDICIONAL necesita su condición (o {"tipo":"manual"}). Track «Hereda» solo con geometría «hereda».',
    ],
    [
      `Hoja ${HOJA_VALIDACIONES}`,
      'Una fila por validación o alerta del método, en orden. «Tipo de control» (RN-31): obligatorio, advertencia, informativo, referencia o criterio_humano; solo «obligatorio» bloquea o genera incumplimiento.',
    ],
    [
      'Grupos válidos',
      datos.especialidades.length === 0
        ? 'El proyecto aún no tiene especialidades: cargue primero la configuración TOCE.'
        : datos.especialidades.map((e) => e.nombre).join(' · '),
    ],
    [
      'Listas',
      'Las columnas con valores cerrados tienen lista desplegable (Clase, Track, Tipo de unidad, Geometría, Sí/No, Tipo de validación, Tipo de control).',
    ],
    [
      'No se carga aquí',
      'La hoja 02_Reglas_Globales de D01 (F-01…F-11, T-01…T-12) y la programación A01.',
    ],
    [
      'Errores',
      'Lo que no se pueda interpretar se informa como error de esa fila y columna; nada se aplica mientras haya errores.',
    ],
  ];
  for (const [a, b] of lineas) {
    const r = instrucciones.addRow([a, b]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }
  instrucciones.addRow([]);
  instrucciones.addRow(['Columna', 'Qué contiene']).font = { bold: true };
  for (const [c, t] of [...Object.entries(AYUDA_APP), ...Object.entries(AYUDA_VALIDACION)]) {
    instrucciones.addRow([c, t]).getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
};

// ── Lectura ──

const valorDe = (v: ExcelJS.CellValue): Celda => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (v instanceof Date) return v.toISOString();
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('formula' in v || 'sharedFormula' in v) {
    const r = (v as { result?: ExcelJS.CellValue }).result;
    return r === undefined ? null : valorDe(r);
  }
  if ('hyperlink' in v) return valorDe(v.text);
  if ('error' in v) return v.error;
  return null;
};

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const noXlsx = () =>
  new ProblemaHttp(
    415,
    'ARCHIVO_NO_XLSX',
    'El archivo no es un libro de Excel (.xlsx) válido. Descargue la plantilla y súbala en ese formato.',
  );

/** Lee una hoja por sus encabezados (fila 1). Devuelve las filas no vacías. */
const leerHoja = (
  ws: ExcelJS.Worksheet,
  columnas: readonly string[],
): { filas: FilaLeida[]; faltantes: string[] } => {
  const indice = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (celda, n) => {
    const t = valorDe(celda.value);
    if (typeof t === 'string' && t.trim() !== '' && !indice.has(t.trim())) indice.set(t.trim(), n);
  });
  const faltantes = columnas.filter((c) => !indice.has(c));
  const filas: FilaLeida[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const fila = ws.getRow(r);
    const celdas: Record<string, Celda> = {};
    let vacia = true;
    for (const c of columnas) {
      const n = indice.get(c);
      if (n === undefined) continue;
      const v = valorDe(fila.getCell(n).value);
      celdas[c] = v;
      if (v !== null && !(typeof v === 'string' && v.trim() === '')) vacia = false;
    }
    if (!vacia) filas.push({ fila: r, celdas });
  }
  return { filas, faltantes };
};

/**
 * Libro subido → filas de métodos y de validaciones. El tipo se valida por contenido (firma ZIP y
 * lectura como xlsx), no por la extensión: lo que no es xlsx da 415; un xlsx sin las hojas o los
 * encabezados de la plantilla, 422.
 */
export const leerLibroD01 = async (
  datos: Buffer,
): Promise<{ metodos: FilaLeida[]; validaciones: FilaLeida[] }> => {
  if (datos.length < 4 || !datos.subarray(0, 4).equals(ZIP)) throw noXlsx();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(datos as unknown as ExcelJS.Buffer);
  } catch {
    throw noXlsx();
  }
  const wsMetodos = wb.getWorksheet(HOJA_METODOS);
  if (wsMetodos === undefined) {
    throw new ProblemaHttp(
      422,
      'PLANTILLA_INVALIDA',
      `El libro no tiene la hoja «${HOJA_METODOS}». Use la plantilla que descarga esta página.`,
    );
  }
  const metodos = leerHoja(wsMetodos, COLUMNAS_METODOS);
  const wsValidaciones = wb.getWorksheet(HOJA_VALIDACIONES);
  const validaciones =
    wsValidaciones === undefined
      ? { filas: [], faltantes: [...COLUMNAS_VALIDACIONES] }
      : leerHoja(wsValidaciones, COLUMNAS_VALIDACIONES);
  const faltan = [
    ...metodos.faltantes.map((c) => `${HOJA_METODOS} › ${c}`),
    ...validaciones.faltantes.map((c) => `${HOJA_VALIDACIONES} › ${c}`),
  ];
  if (faltan.length > 0) {
    throw new ProblemaHttp(
      422,
      'PLANTILLA_INVALIDA',
      `Faltan hojas o columnas de la plantilla: ${faltan.slice(0, 10).join('; ')}${faltan.length > 10 ? '…' : ''}.`,
    );
  }
  return { metodos: metodos.filas, validaciones: validaciones.filas };
};
