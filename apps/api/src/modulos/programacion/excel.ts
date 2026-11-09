import {
  ACTIVIDADES_ESPECIALES,
  AID_AII,
  CAMPOS_FILA_PROGRAMACION,
  campoDeEncabezado,
  COLUMNAS_DE_HOJA,
  ESTADOS_FILA_CRONOGRAMA,
  ETIQUETA_ESTADO_FILA_A01,
  ETIQUETA_TIPO_ACTIVIDAD_A01,
  FILAS_MAXIMAS_PROGRAMACION,
  filaVacia,
  HOJA_ACTIVIDADES_ESPECIALES,
  HOJA_INSTRUCCIONES,
  HOJA_PROGRAMACION,
  hojaDeNombre,
  REGIONES_PROGRAMACION,
  SIN_ZA_EF,
  TIPOS_ACTIVIDAD_CRONOGRAMA,
  TIPOS_PROGRAMACION_A01,
  type CampoFilaProgramacion,
  type FilaProgramacionEntrada,
  type HojaProgramacion,
} from '@campo/core';
import ExcelJS from 'exceljs';
import { ProblemaHttp } from '../../plataforma/errores.ts';

/**
 * Plantilla y lectura de la programación A01 en Excel (RF-W09) con ExcelJS (`03` §2). Las hojas
 * y encabezados son los de A01 (hoja 01_Programacion y hoja 02 de actividades especiales); las
 * listas desplegables toman los valores admitidos del modelo y de A01, y las brigadas del
 * proyecto. Las fórmulas nunca se ejecutan: de una celda con fórmula se toma el último valor que
 * Excel guardó.
 */

const HOJA_LISTAS = 'Listas';
/** Filas con listas desplegables más allá de las que trae la plantilla. */
const FILAS_EXTRA = 500;

type ValorCelda = string | number | null;

export interface DatosPlantilla {
  readonly proyecto: string;
  /** Códigos (o nombres) de las brigadas que la persona puede programar. */
  readonly brigadas: readonly string[];
  /** ZA/EF ya usadas por las estaciones del proyecto (la lista admite otras). */
  readonly zaEf: readonly string[];
  /** Filas con la programación actual (vacío para la plantilla vacía). */
  readonly filas: readonly FilaProgramacionEntrada[];
  /** De dónde salen las filas, para la hoja de instrucciones. */
  readonly fuente: string | null;
}

interface ConValidaciones {
  readonly dataValidations: {
    add: (rango: string, validacion: ExcelJS.DataValidation) => void;
  };
}

const letra = (columna: number): string => {
  let n = columna;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const LISTAS: readonly { readonly campo: CampoFilaProgramacion; readonly titulo: string }[] = [
  { campo: 'tipo_programacion', titulo: 'Tipo programación' },
  { campo: 'region', titulo: 'Región' },
  { campo: 'actividad', titulo: 'Actividad' },
  { campo: 'brigada', titulo: 'Brigada' },
  { campo: 'tipo_actividad', titulo: 'Tipo actividad' },
  { campo: 'aid_aii', titulo: 'AID/AII' },
  { campo: 'za_ef', titulo: 'ZA/EF' },
  { campo: 'estado', titulo: 'Estado' },
];

const valoresDeLista = (campo: CampoFilaProgramacion, d: DatosPlantilla): readonly string[] => {
  switch (campo) {
    case 'tipo_programacion':
      return TIPOS_PROGRAMACION_A01;
    case 'region':
      return REGIONES_PROGRAMACION;
    case 'actividad':
      return ACTIVIDADES_ESPECIALES;
    case 'brigada':
      return d.brigadas;
    case 'tipo_actividad':
      return TIPOS_ACTIVIDAD_CRONOGRAMA.map((t) => ETIQUETA_TIPO_ACTIVIDAD_A01[t]);
    case 'aid_aii':
      return AID_AII;
    case 'za_ef':
      return [SIN_ZA_EF, ...d.zaEf];
    case 'estado':
      return ESTADOS_FILA_CRONOGRAMA.map((e) => ETIQUETA_ESTADO_FILA_A01[e]);
    default:
      return [];
  }
};

const fechaComoDate = (v: ValorCelda): Date | ValorCelda => {
  if (typeof v !== 'string') return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m === null ? v : new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
};

/** Libro .xlsx con las hojas de A01, listas desplegables e instrucciones. */
export const generarPlantilla = async (d: DatosPlantilla): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Plataforma de campo';
  wb.created = new Date();

  // Valores de cada lista en una hoja oculta que va al final (Excel limita a 255 caracteres una
  // lista en línea). Los rangos se conocen antes de crearla.
  const rangoDe = new Map<CampoFilaProgramacion, string>();
  LISTAS.forEach((l, i) => {
    const col = letra(i + 1);
    const fin = Math.max(2, valoresDeLista(l.campo, d).length + 1);
    rangoDe.set(l.campo, `${HOJA_LISTAS}!$${col}$2:$${col}$${String(fin)}`);
  });

  const hojas: readonly [HojaProgramacion, string][] = [
    ['programacion', HOJA_PROGRAMACION],
    ['actividades_especiales', HOJA_ACTIVIDADES_ESPECIALES],
  ];
  for (const [hoja, nombre] of hojas) {
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    const columnas = COLUMNAS_DE_HOJA[hoja];
    ws.columns = columnas.map((c) => ({
      header: c,
      key: c,
      width: c === 'UV preliminar' || c === 'Detalle operativo' ? 34 : c === 'ZA/EF' ? 26 : 16,
    }));
    const encabezado = ws.getRow(1);
    encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
    encabezado.alignment = { vertical: 'middle', wrapText: true };

    const filas = d.filas.filter((f) => f.hoja === hoja);
    for (const f of filas) {
      ws.addRow(
        columnas.map((c) => {
          const campo = campoDeEncabezado(c);
          const v = campo === undefined ? null : (f[campo] ?? null);
          return campo === 'fecha' ? fechaComoDate(v) : v;
        }),
      );
    }

    const ultima = filas.length + 1 + FILAS_EXTRA;
    const v = ws as unknown as ConValidaciones;
    columnas.forEach((c, i) => {
      const campo = campoDeEncabezado(c);
      const col = letra(i + 1);
      const rango = `${col}2:${col}${String(ultima)}`;
      if (campo === 'fecha') {
        ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
        v.dataValidations.add(rango, {
          type: 'date',
          operator: 'greaterThan',
          allowBlank: true,
          formulae: [new Date(Date.UTC(2000, 0, 1))],
          showErrorMessage: true,
          errorTitle: 'Fecha TH',
          error: 'Escriba una fecha válida (AAAA-MM-DD).',
        });
        return;
      }
      if (campo === 'este' || campo === 'norte') {
        v.dataValidations.add(rango, {
          type: 'decimal',
          operator: 'between',
          allowBlank: true,
          formulae: campo === 'este' ? [100_000, 900_000] : [0, 10_000_000],
          showErrorMessage: true,
          errorTitle: c,
          error: 'Coordenada UTM WGS 84 fuera de rango.',
        });
        return;
      }
      const lista = campo === undefined ? undefined : rangoDe.get(campo);
      if (lista === undefined) return;
      v.dataValidations.add(rango, {
        type: 'list',
        allowBlank: true,
        formulae: [lista],
        showErrorMessage: true,
        // ZA/EF admite una zona nueva: solo advierte.
        errorStyle: campo === 'za_ef' ? 'warning' : 'stop',
        errorTitle: c,
        error:
          campo === 'za_ef'
            ? 'No es una ZA/EF registrada. Si es correcta, puede conservarla.'
            : 'Elija un valor de la lista.',
      });
    });
  }

  const inst = wb.addWorksheet(HOJA_INSTRUCCIONES);
  inst.getColumn(1).width = 110;
  const lineas = [
    `Programación A01 · ${d.proyecto}`,
    '',
    'Cómo usar esta plantilla',
    '1. Llene la hoja 01_Programacion con la programación regular y complementaria, y la hoja 02_Actividades_especiales con epífitas y cámaras trampa. Las columnas son las de A01: no cambie los encabezados.',
    '2. Use las listas desplegables: Tipo programación, Región, Actividad, Brigada, Tipo actividad, AID/AII, ZA/EF y Estado.',
    '3. Fecha TH en formato AAAA-MM-DD. Solo las filas de tipo ESTACIÓN llevan estación.',
    '4. Si la estación ya existe en el proyecto, basta su código; sus atributos registrados se conservan. Para una estación nueva indique Zona UTM (p. ej. 18 S), Este, Norte (UTM WGS 84), AID/AII y UV preliminar; ZA/EF «—» si no aplica.',
    '5. Suba el archivo en la web (Cronograma › Cargar programación por Excel). Verá una vista previa con lo nuevo, lo que cambia y los errores por fila antes de aplicar nada.',
    '',
    'Qué pasa al aplicar',
    '• Si el proyecto aún no tiene cronograma base, las filas pasan al borrador, que se publica después como base.',
    '• Si ya tiene base, los cambios se envían como una solicitud de reprogramación que aprueba el Jefe de Proyecto (RN-35, RN-36).',
    '• Nada se elimina: una estación que no venga en el archivo se conserva tal como está.',
    '• El Supervisor de campo solo puede sugerir la programación de sus brigadas; Coordinación o el Jefe de Proyecto la revisan y la aplican.',
    '• Las fórmulas no se ejecutan: se toma el último valor que Excel guardó en la celda.',
  ];
  if (d.fuente !== null) lineas.splice(1, 0, `Contiene: ${d.fuente}.`);
  lineas.forEach((t, i) => {
    const c = inst.getCell(i + 1, 1);
    c.value = t;
    c.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0 || t === 'Cómo usar esta plantilla' || t === 'Qué pasa al aplicar') {
      c.font = { bold: true, size: i === 0 ? 14 : 12 };
    }
  });

  const listas = wb.addWorksheet(HOJA_LISTAS, { state: 'veryHidden' });
  LISTAS.forEach((l, i) => {
    listas.getCell(1, i + 1).value = l.titulo;
    valoresDeLista(l.campo, d).forEach((v, j) => {
      listas.getCell(j + 2, i + 1).value = v;
    });
  });

  const salida = await wb.xlsx.writeBuffer();
  return Buffer.from(salida);
};

// ── Lectura ───────────────────────────────────────────────────────────────────

const aIsoUtc = (d: Date): string | null =>
  Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);

/** Valor de una celda de ExcelJS como texto, número o nulo (sin ejecutar fórmulas). */
const valorDe = (v: ExcelJS.CellValue): ValorCelda => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (v instanceof Date) return aIsoUtc(v);
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('error' in v) return v.error;
  if ('formula' in v || 'sharedFormula' in v) {
    const r = (v as { result?: unknown }).result;
    if (r instanceof Date) return aIsoUtc(r);
    return typeof r === 'string' || typeof r === 'number' ? r : null;
  }
  if ('text' in v) return typeof v.text === 'string' ? v.text : null;
  return null;
};

const errorLibro = (detalle: string): ProblemaHttp =>
  new ProblemaHttp(422, 'PLANTILLA_INVALIDA', detalle);

/** Filas de las hojas 01 y 02 (las demás hojas se ignoran). Lanza 422 si faltan columnas. */
export const leerProgramacionXlsx = async (libro: Buffer): Promise<FilaProgramacionEntrada[]> => {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(libro as unknown as ArrayBuffer);
  } catch {
    throw new ProblemaHttp(
      415,
      'ARCHIVO_NO_XLSX',
      'No se pudo leer el libro de Excel. Use la plantilla descargada desde la web.',
    );
  }
  const filas: FilaProgramacionEntrada[] = [];
  let hojasLeidas = 0;
  for (const ws of wb.worksheets) {
    const hoja = hojaDeNombre(ws.name);
    if (hoja === undefined) continue;
    hojasLeidas += 1;
    const columnas = new Map<number, CampoFilaProgramacion>();
    ws.getRow(1).eachCell((c, n) => {
      const t = valorDe(c.value);
      const campo = typeof t === 'string' ? campoDeEncabezado(t) : undefined;
      if (campo !== undefined) columnas.set(n, campo);
    });
    const presentes = new Set(columnas.values());
    const faltan = COLUMNAS_DE_HOJA[hoja].filter((c) => {
      const campo = campoDeEncabezado(c);
      return campo !== undefined && !presentes.has(campo);
    });
    if (faltan.length > 0) {
      throw errorLibro(`A la hoja «${ws.name}» le faltan las columnas: ${faltan.join(', ')}.`);
    }
    for (let n = 2; n <= ws.rowCount; n++) {
      const fila = ws.getRow(n);
      const entrada: Record<string, ValorCelda> = {};
      for (const [col, campo] of columnas) entrada[campo] = valorDe(fila.getCell(col).value);
      const e: FilaProgramacionEntrada = { hoja, fila: n };
      for (const campo of CAMPOS_FILA_PROGRAMACION) {
        const v = entrada[campo];
        if (v !== undefined) e[campo] = typeof v === 'string' ? v.slice(0, 1_000) : v;
      }
      if (filaVacia(e)) continue;
      filas.push(e);
      if (filas.length > FILAS_MAXIMAS_PROGRAMACION) {
        throw errorLibro(
          `El libro tiene más de ${String(FILAS_MAXIMAS_PROGRAMACION)} filas: divídalo en varias cargas.`,
        );
      }
    }
  }
  if (hojasLeidas === 0) {
    throw errorLibro(
      `El libro no tiene las hojas «${HOJA_PROGRAMACION}» ni «${HOJA_ACTIVIDADES_ESPECIALES}». Use la plantilla descargable.`,
    );
  }
  if (filas.length === 0) throw errorLibro('El libro no tiene filas de programación.');
  return filas;
};
