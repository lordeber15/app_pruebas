import { describe, expect, it } from 'vitest';
import { configuracionMetodoSchema, type ConfiguracionMetodo } from './metodo.ts';
import {
  COL,
  COLUMNAS_D01,
  COLUMNAS_METODOS,
  COLV,
  diferenciasMetodo,
  HOJA_METODOS,
  HOJA_VALIDACIONES,
  leerPlantillaD01,
  LISTAS_METODOS,
  metodoAFila,
  TIPOS_VALIDACION,
  validacionesAFilas,
  type Celda,
  type FilaLeida,
} from './plantilla-d01.ts';

const ESPECIALIDADES = [
  { codigo: 'aves', nombre: 'AVES' },
  { codigo: 'flora_vegetacion', nombre: 'FLORA Y VEGETACIÓN' },
];

const aves: ConfiguracionMetodo = configuracionMetodoSchema.parse({
  codigo: 'aves.puntos_conteo',
  nombre: 'PUNTOS DE CONTEO',
  especialidad: 'aves',
  clase: 'condicional',
  aplicacion: {
    texto: 'Estaciones de costa y sierra, excepto lagos.',
    condicion: {
      tipo: 'region_excepto_uv',
      regiones: ['COSTA', 'SIERRA'],
      uv_excluida_contiene: ['lacustre'],
    },
  },
  unidad: { tipo: 'punto', tipos_adicionales: [], texto: 'Punto de conteo de 10 minutos.' },
  esfuerzo: {
    estandar: { cantidad: 10, unidad: 'puntos de conteo', texto: '10 puntos de conteo.' },
    za_ef: { cantidad: 20, texto: '20 puntos de conteo.' },
  },
  horario: {
    ventanas: [
      { inicio: '06:00', fin: '10:00' },
      { inicio: '16:00', fin: '18:00' },
    ],
    texto: '06:00–10:00 y 16:00–18:00',
  },
  geometria: { tipo: 'punto', texto: 'Punto por conteo', vinculo_metodo: null, detalle: null },
  track: false,
  fotos: {
    contexto: {
      cantidad_por_unidad: 4,
      cardinales: true,
      reutiliza_metodo: null,
      texto: '4 panorámicas N-S-E-O',
    },
    metodologicas: { minimo: 2, texto: 'Mínimo 2 por estación/método' },
  },
  campos: [{ clave: 'habitat', etiqueta: 'Hábitat', tipo: 'texto', requerido: true }],
  registros: {
    etiqueta: 'Especies',
    campos: [{ clave: 'especie', etiqueta: 'Especie', tipo: 'texto', requerido: true }],
  },
  validaciones: [
    {
      tipo: 'cantidad_unidades',
      minimo: 10,
      minimo_za_ef: 20,
      tipo_control: 'obligatorio',
      texto: 'Validar número de puntos.',
    },
    {
      tipo: 'separacion_minima_m',
      metros: 200,
      tipo_control: 'obligatorio',
      texto: 'Separación mínima de 200 m.',
    },
    {
      tipo: 'horario',
      ventanas: [{ inicio: '06:00', fin: '10:00' }],
      tipo_control: 'advertencia',
      texto: 'Horario de conteo.',
    },
    { tipo: 'mensaje', tipo_control: 'informativo', texto: 'Registrar clima.' },
  ],
  vinculo: { texto: 'Comparte fotos con listas.', metodos: ['aves.listas_20'] },
  fuente: {
    estado: 'CERRADO',
    origen: 'Metodología fuente',
    pendiente: 'Confirmar estaciones',
    campos: 'Especie, número de individuos.',
    validaciones: 'Validar número de puntos, separación.',
    asignacion: 'Habilitar en costa y sierra.',
  },
});

const atributo: ConfiguracionMetodo = configuracionMetodoSchema.parse({
  codigo: 'flora_vegetacion.formas',
  nombre: 'FORMAS DE CRECIMIENTO',
  especialidad: 'flora_vegetacion',
  clase: 'atributo',
  aplicacion: { texto: 'Se registra dentro de otros métodos.', condicion: null },
  unidad: { tipo: 'atributo', tipos_adicionales: [], texto: null },
  esfuerzo: { estandar: null, za_ef: null },
  horario: null,
  geometria: { tipo: 'hereda', texto: 'Hereda', vinculo_metodo: null, detalle: null },
  track: false,
  fotos: {
    contexto: {
      cantidad_por_unidad: null,
      cardinales: false,
      reutiliza_metodo: null,
      texto: 'No aplica',
    },
    metodologicas: { minimo: 0, texto: 'No aplica' },
  },
  campos: [],
  registros: null,
  validaciones: [],
  vinculo: null,
  fuente: { estado: 'CERRADO COMO ATRIBUTO', origen: 'D01', pendiente: 'Ninguno' },
});

let n = 1;
const fila = (celdas: Readonly<Record<string, Celda>>): FilaLeida => ({ fila: ++n, celdas });
const filas = (metodos: readonly ConfiguracionMetodo[]) => ({
  metodos: metodos.map((m) =>
    fila(metodoAFila(m, ESPECIALIDADES.find((e) => e.codigo === m.especialidad)?.nombre ?? '')),
  ),
  validaciones: metodos.flatMap((m) => validacionesAFilas(m).map(fila)),
});
const conocidos = new Set(['aves.listas_20']);

describe('plantilla Excel de D01 (RF-W09)', () => {
  it('RF-W09: la hoja de métodos lleva primero los 19 encabezados de D01, verbatim', () => {
    expect(COLUMNAS_D01).toHaveLength(19);
    expect(COLUMNAS_METODOS.slice(0, 19)).toEqual(COLUMNAS_D01);
    expect(COLUMNAS_D01[0]).toBe('Grupo');
    expect(COLUMNAS_D01[16]).toBe('Clase de aplicabilidad provisional');
    expect(LISTAS_METODOS[COL.clase]).toEqual([
      'TODAS',
      'CONDICIONAL',
      'EVENTO',
      'ATRIBUTO',
      'TRANSVERSAL',
    ]);
    expect(TIPOS_VALIDACION).toContain('confirmacion');
  });

  it('RF-W09: exportar y volver a leer da la misma configuración y 0 cambios', () => {
    const r = leerPlantillaD01(filas([aves, atributo]), ESPECIALIDADES, conocidos);
    expect(r.errores).toEqual([]);
    expect(r.metodos.map((m) => m.config)).toEqual([aves, atributo]);
    expect(diferenciasMetodo(aves, r.metodos[0]?.config ?? aves)).toEqual([]);
  });

  it('RF-W09: el track «Hereda» se exporta para un ATRIBUTO y se lee como sin track', () => {
    expect(metodoAFila(atributo, 'FLORA Y VEGETACIÓN')[COL.track]).toBe('Hereda');
    const f = filas([aves]);
    const m = f.metodos[0];
    if (m === undefined) throw new Error('sin fila');
    const r = leerPlantillaD01(
      { ...f, metodos: [{ ...m, celdas: { ...m.celdas, [COL.track]: 'Hereda' } }] },
      ESPECIALIDADES,
      conocidos,
    );
    expect(r.errores[0]).toMatchObject({ columna: COL.track });
  });

  it('RF-W09: un umbral cambiado aparece en el diff con etiqueta legible', () => {
    const f = filas([aves]);
    const v = f.validaciones[1];
    if (v === undefined) throw new Error('sin validación');
    const r = leerPlantillaD01(
      {
        ...f,
        validaciones: f.validaciones.map((x) =>
          x === v ? { ...v, celdas: { ...v.celdas, [COLV.valor]: 250 } } : x,
        ),
      },
      ESPECIALIDADES,
      conocidos,
    );
    expect(r.errores).toEqual([]);
    const nuevo = r.metodos[0]?.config;
    if (nuevo === undefined) throw new Error('sin método');
    expect(diferenciasMetodo(aves, nuevo)).toEqual([
      { campo: 'Validación [2 separacion_minima_m] › metros', antes: '200', despues: '250' },
    ]);
  });

  it('RF-W09: los números con coma decimal y las ventanas H:MM se aceptan', () => {
    const f = filas([aves]);
    const m = f.metodos[0];
    if (m === undefined) throw new Error('sin fila');
    const r = leerPlantillaD01(
      {
        ...f,
        metodos: [
          {
            ...m,
            celdas: {
              ...m.celdas,
              [COL.esfuerzo_cantidad]: '10,5',
              [COL.horario_ventanas]: '6:00 – 10:00; 16:00-18:00',
            },
          },
        ],
      },
      ESPECIALIDADES,
      conocidos,
    );
    expect(r.errores).toEqual([]);
    const c = r.metodos[0]?.config;
    expect(c?.esfuerzo.estandar?.cantidad).toBe(10.5);
    expect(c?.horario?.ventanas[0]).toEqual({ inicio: '06:00', fin: '10:00' });
  });

  it('RF-W09: cada celda inválida es un error con hoja, fila y columna', () => {
    const f = filas([aves]);
    const m = f.metodos[0];
    if (m === undefined) throw new Error('sin fila');
    const r = leerPlantillaD01(
      {
        ...f,
        metodos: [
          {
            ...m,
            celdas: {
              ...m.celdas,
              [COL.clase]: 'A VECES',
              [COL.tipo_geometria]: 'linea',
              [COL.esfuerzo_cantidad]: 'tres',
              [COL.horario_ventanas]: 'mañana',
              [COL.condicion]: '{no es json',
              [COL.detalle]: '{"otra":1}',
              [COL.fotos_metodologicas_min]: 1.5,
              [COL.grupo]: 'PECES',
              [COL.fotos_cardinales]: null,
            },
          },
        ],
      },
      ESPECIALIDADES,
      conocidos,
    );
    expect(r.metodos).toEqual([]);
    const columnas = r.errores.map((e) => e.columna);
    expect(columnas).toEqual(
      expect.arrayContaining([
        COL.clase,
        COL.tipo_geometria,
        COL.esfuerzo_cantidad,
        COL.horario_ventanas,
        COL.condicion,
        COL.detalle,
        COL.fotos_metodologicas_min,
        COL.grupo,
        COL.fotos_cardinales,
      ]),
    );
    expect(r.errores.every((e) => e.hoja === HOJA_METODOS && e.fila === m.fila)).toBe(true);
  });

  it('RF-W09: sin texto de D01 no se admite un parámetro (la app no inventa esfuerzos)', () => {
    const f = filas([atributo]);
    const m = f.metodos[0];
    if (m === undefined) throw new Error('sin fila');
    const r = leerPlantillaD01(
      {
        ...f,
        metodos: [
          {
            ...m,
            celdas: {
              ...m.celdas,
              [COL.esfuerzo_cantidad]: 3,
              [COL.za_ef_cantidad]: 6,
              [COL.horario_ventanas]: '06:00-10:00',
              [COL.vinculo_metodos]: 'aves.puntos_conteo',
            },
          },
        ],
      },
      ESPECIALIDADES,
    );
    expect(r.errores.map((e) => e.columna)).toEqual([
      COL.esfuerzo_cantidad,
      COL.za_ef_cantidad,
      COL.horario_ventanas,
      COL.vinculo_metodos,
    ]);
  });

  it('RF-W09: errores de la hoja de validaciones señalan su fila y columna', () => {
    const f = filas([aves]);
    const [v0, v1, v2, v3] = f.validaciones;
    if (v0 === undefined || v1 === undefined || v2 === undefined || v3 === undefined)
      throw new Error('faltan validaciones');
    const r = leerPlantillaD01(
      {
        ...f,
        validaciones: [
          { ...v0, celdas: { ...v0.celdas, [COLV.valor]: -1 } },
          { ...v1, celdas: { ...v1.celdas, [COLV.control]: 'a veces', [COLV.valor_za_ef]: 3 } },
          { ...v2, celdas: { ...v2.celdas, [COLV.otros]: '{"texto":"x"}' } },
          { ...v3, celdas: { ...v3.celdas, [COLV.metodo]: 'aves.otro' } },
          { fila: 99, celdas: { [COLV.metodo]: null } },
          // Un informativo nunca es obligatorio (RN-31).
          { ...v3, fila: 100, celdas: { ...v3.celdas, [COLV.control]: 'obligatorio' } },
        ],
      },
      ESPECIALIDADES,
      conocidos,
    );
    expect(r.metodos).toEqual([]);
    const vistos = r.errores.map((e) => [e.hoja, e.fila, e.columna]);
    expect(vistos).toEqual(
      expect.arrayContaining([
        [HOJA_VALIDACIONES, v1.fila, COLV.control],
        [HOJA_VALIDACIONES, v1.fila, COLV.valor_za_ef],
        [HOJA_VALIDACIONES, v2.fila, COLV.otros],
        [HOJA_VALIDACIONES, v3.fila, COLV.metodo],
        [HOJA_VALIDACIONES, 99, COLV.metodo],
      ]),
    );
  });

  it('RF-W09: el error de esquema de una validación se ubica en su columna', () => {
    const f = filas([aves]);
    const [v0, ...resto] = f.validaciones;
    if (v0 === undefined) throw new Error('sin validación');
    const r = leerPlantillaD01(
      { ...f, validaciones: [{ ...v0, celdas: { ...v0.celdas, [COLV.valor]: -1 } }, ...resto] },
      ESPECIALIDADES,
      conocidos,
    );
    expect(r.errores).toEqual([
      expect.objectContaining({ hoja: HOJA_VALIDACIONES, fila: v0.fila, columna: COLV.valor }),
    ]);
  });

  it('RF-W09: códigos repetidos y vínculos a métodos desconocidos son errores', () => {
    const f = filas([aves, aves]);
    const r = leerPlantillaD01(f, ESPECIALIDADES);
    expect(r.errores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ columna: COL.codigo, fila: f.metodos[1]?.fila }),
        expect.objectContaining({ columna: COL.vinculo_metodos, fila: f.metodos[0]?.fila }),
      ]),
    );
    expect(r.metodos).toEqual([]);
  });

  it('RF-W09: un CONDICIONAL sin condición y una vinculada sin método son errores', () => {
    const f = filas([aves]);
    const m = f.metodos[0];
    if (m === undefined) throw new Error('sin fila');
    const r = leerPlantillaD01(
      {
        ...f,
        metodos: [
          {
            ...m,
            celdas: { ...m.celdas, [COL.condicion]: null, [COL.tipo_geometria]: 'vinculada' },
          },
        ],
      },
      ESPECIALIDADES,
      conocidos,
    );
    expect(r.errores.map((e) => e.columna)).toEqual([COL.condicion, COL.geometria_vinculo]);
  });

  it('RF-W09: una fila vacía en obligatorios lista cada columna faltante', () => {
    const r = leerPlantillaD01({ metodos: [{ fila: 2, celdas: {} }], validaciones: [] }, []);
    expect(r.errores.map((e) => e.columna)).toEqual(
      expect.arrayContaining([
        COL.codigo,
        COL.grupo,
        COL.clase,
        COL.tipo_unidad,
        COL.tipo_geometria,
        COL.track,
        COL.fotos_cardinales,
        COL.fotos_metodologicas_min,
      ]),
    );
  });

  it('RF-W09: un código con formato inválido es error de su columna', () => {
    const f = filas([aves]);
    const m = f.metodos[0];
    if (m === undefined) throw new Error('sin fila');
    const r = leerPlantillaD01(
      {
        ...f,
        metodos: [{ ...m, celdas: { ...m.celdas, [COL.codigo]: 'Aves Puntos' } }],
      },
      ESPECIALIDADES,
      conocidos,
    );
    expect(r.errores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ columna: COL.codigo, hoja: HOJA_METODOS }),
        // Sus validaciones ya no encuentran el método.
        expect.objectContaining({ columna: COLV.metodo, hoja: HOJA_VALIDACIONES }),
      ]),
    );
  });

  it('RF-W09: el diff marca campos agregados y quitados', () => {
    const cambios = diferenciasMetodo(atributo, {
      ...atributo,
      esfuerzo: { estandar: { cantidad: 1, unidad: 'u', texto: 't' }, za_ef: null },
      campos: [{ clave: 'nota', etiqueta: 'Nota', tipo: 'texto', requerido: false }],
    });
    expect(cambios).toEqual(
      expect.arrayContaining([
        { campo: 'Esfuerzo estándar: cantidad', antes: '—', despues: '1' },
        { campo: 'Campo de la unidad [nota] › etiqueta', antes: '—', despues: 'Nota' },
      ]),
    );
  });
});
