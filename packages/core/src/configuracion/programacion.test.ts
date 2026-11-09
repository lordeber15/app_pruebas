import { describe, expect, it } from 'vitest';
import {
  campoDeEncabezado,
  cambiosDeFilaComparada,
  compararProgramacion,
  fechaDeCelda,
  filaVacia,
  hojaDeNombre,
  validarFilaProgramacion,
  type FilaExistente,
  type FilaProgramacionEntrada,
  type FilaResuelta,
} from './programacion.ts';

/** Fila de A01 hoja 01 (EM-27, COSTA, 2026-12-13), tal como viene del Excel del cliente. */
const em27: FilaProgramacionEntrada = {
  hoja: 'programacion',
  fila: 3,
  tipo_programacion: 'REGULAR',
  region: 'COSTA',
  brigada: 'COSTA',
  fecha: '2026-12-13',
  tipo_actividad: 'ESTACIÓN',
  estacion: 'EM-27',
  zona_utm: '17 S',
  este: 717327,
  norte: 9109390,
  aid_aii: 'AII',
  uv: 'Loma efímera',
  za_ef: '—',
  detalle: null,
  estado: 'OK',
};

describe('RF-W09 validación de una fila de programación A01', () => {
  it('acepta una fila de A01 y normaliza sus valores de lista', () => {
    const r = validarFilaProgramacion(em27);
    expect(r.errores).toEqual([]);
    expect(r.valor).toMatchObject({
      tipo_programacion: 'REGULAR',
      region: 'COSTA',
      tipo_actividad: 'estacion',
      estacion: 'EM-27',
      zona_utm: '17 S',
      za_ef: null,
      estado_fila: 'ok',
    });
  });

  it('tolera tildes y mayúsculas, y reconoce las etiquetas de A01', () => {
    const r = validarFilaProgramacion({
      ...em27,
      tipo_actividad: 'estacion',
      estado: 'pendiente validacion',
      region: 'Costa',
    });
    expect(r.valor?.estado_fila).toBe('pendiente_validacion');
    const f = validarFilaProgramacion({
      ...em27,
      tipo_actividad: 'FERIADO / NO OPERATIVO',
      estacion: null,
      zona_utm: null,
      este: null,
      norte: null,
      aid_aii: null,
      uv: null,
      za_ef: null,
      detalle: 'Noche buena',
    });
    expect(f.valor?.tipo_actividad).toBe('feriado');
  });

  it('da un error claro por cada valor fuera de lista o faltante', () => {
    const r = validarFilaProgramacion({
      ...em27,
      tipo_programacion: 'ESPECIAL',
      region: 'PUNA',
      fecha: '31/02/2026',
      estado: null,
      zona_utm: '99 Z',
    });
    expect(r.valor).toBeNull();
    expect(r.errores).toEqual([
      'Tipo programación: elija REGULAR, COMPLEMENTARIA.',
      'Región: elija COSTA, SIERRA, SELVA, COMPLEMENTARIA.',
      'Fecha TH: no es una fecha válida (use AAAA-MM-DD o DD/MM/AAAA).',
      'Estado: elija OK, PENDIENTE VALIDACIÓN, REPROGRAMADA, SUJETA A DECISIÓN.',
      'Zona UTM: no es válida (por ejemplo, 18 S).',
    ]);
  });

  it('una actividad ESTACIÓN indica estación; las demás no la llevan', () => {
    expect(validarFilaProgramacion({ ...em27, estacion: null }).errores).toContain(
      'Estación: una actividad de tipo ESTACIÓN indica su estación.',
    );
    expect(validarFilaProgramacion({ ...em27, tipo_actividad: 'TRASLADO' }).errores).toContain(
      'Estación: solo las actividades de tipo ESTACIÓN llevan estación.',
    );
  });

  it('la ubicación va completa y dentro del rango UTM', () => {
    expect(validarFilaProgramacion({ ...em27, norte: null }).errores).toContain(
      'Ubicación: indique juntas la Zona UTM, el Este y el Norte.',
    );
    expect(validarFilaProgramacion({ ...em27, este: 5 }).errores).toContain(
      'Este: debe ser un número entre 100 000 y 900 000 (UTM WGS 84).',
    );
    // Coma decimal (BL-18 de A01: 789777.389).
    expect(validarFilaProgramacion({ ...em27, este: '789777,389' }).valor?.este).toBe(789777.389);
  });

  it('hoja 02: la actividad especial va en la lista de A01', () => {
    const base = {
      ...em27,
      hoja: 'actividades_especiales' as const,
      tipo_programacion: null,
      region: null,
    };
    expect(
      validarFilaProgramacion({ ...base, actividad: 'EPÍFITAS' }).valor?.actividad_especial,
    ).toBe('EPÍFITAS');
    expect(
      validarFilaProgramacion({ ...base, actividad: 'camaras trampa' }).valor?.actividad_especial,
    ).toBe('CÁMARAS TRAMPA');
    expect(validarFilaProgramacion({ ...base, actividad: 'AVES' }).errores).toEqual([
      'Actividad: elija EPÍFITAS, CÁMARAS TRAMPA.',
    ]);
  });

  it('fechas: ISO, DD/MM/AAAA y número de serie de Excel', () => {
    expect(fechaDeCelda('2026-12-13')).toBe('2026-12-13');
    expect(fechaDeCelda('13/12/2026')).toBe('2026-12-13');
    expect(fechaDeCelda(46369)).toBe('2026-12-13');
    expect(fechaDeCelda('2026-02-30')).toBeNull();
    expect(fechaDeCelda('mañana')).toBeNull();
  });

  it('reconoce los encabezados y hojas de A01 y las filas vacías', () => {
    expect(campoDeEncabezado('Tipo programación')).toBe('tipo_programacion');
    expect(campoDeEncabezado('Tipo de actividad')).toBe('tipo_actividad');
    expect(campoDeEncabezado('estacion')).toBe('estacion');
    expect(hojaDeNombre('02_Actividades_Especiales')).toBe('actividades_especiales');
    expect(hojaDeNombre('03_Pendientes')).toBeUndefined();
    expect(filaVacia({ hoja: 'programacion', fila: 9, brigada: '  ' })).toBe(true);
  });
});

const existente = (id: string, x: Partial<FilaExistente> = {}): FilaExistente => ({
  id,
  brigada_id: 'b1',
  fecha: '2026-12-02',
  tipo_actividad: 'estacion',
  estacion: 'EM-36',
  actividad_especial: null,
  detalle: null,
  estado_fila: 'ok',
  ...x,
});
const resuelta = (indice: number, x: Partial<FilaResuelta> = {}): FilaResuelta => ({
  indice,
  brigada_id: 'b1',
  fecha: '2026-12-02',
  tipo_actividad: 'estacion',
  estacion: 'EM-36',
  actividad_especial: null,
  detalle: null,
  estado_fila: 'ok',
  ...x,
});

describe('RN-35 comparación de la carga con el cronograma vigente', () => {
  it('idéntica = sin cambio; otra fecha = cambio; desconocida = nueva; ausente = no incluida', () => {
    const c = compararProgramacion(
      [
        resuelta(0),
        resuelta(1, { estacion: 'EM-37', fecha: '2026-12-05' }),
        resuelta(2, { estacion: 'EM-99' }),
      ],
      [
        existente('a'),
        existente('b', { estacion: 'EM-37', fecha: '2026-12-03' }),
        existente('c', { estacion: 'EM-38' }),
      ],
    );
    expect(c.filas.map((f) => [f.indice, f.accion, f.item_id])).toEqual([
      [0, 'sin_cambio', 'a'],
      [1, 'cambio', 'b'],
      [2, 'nueva', null],
    ]);
    expect(c.filas[1]?.fecha).toEqual({ antes: '2026-12-03', despues: '2026-12-05' });
    expect(c.no_incluidas).toEqual(['c']);
  });

  it('BL-21 dos veces en SIERRA 2: cada fila del archivo empareja con una existente en orden de fecha', () => {
    const c = compararProgramacion(
      [
        resuelta(0, {
          estacion: 'BL-21',
          fecha: '2026-12-16',
          estado_fila: 'pendiente_validacion',
        }),
        resuelta(1, {
          estacion: 'BL-21',
          fecha: '2026-12-18',
          estado_fila: 'pendiente_validacion',
        }),
      ],
      [
        existente('x', {
          estacion: 'BL-21',
          fecha: '2026-12-16',
          estado_fila: 'pendiente_validacion',
        }),
        existente('y', {
          estacion: 'BL-21',
          fecha: '2026-12-17',
          estado_fila: 'pendiente_validacion',
        }),
      ],
    );
    expect(c.filas.map((f) => [f.accion, f.item_id])).toEqual([
      ['sin_cambio', 'x'],
      ['cambio', 'y'],
    ]);
    expect(c.no_incluidas).toEqual([]);
  });

  it('una movilización que cambia de fecha es la misma fila', () => {
    const c = compararProgramacion(
      [
        resuelta(0, {
          tipo_actividad: 'movilizacion',
          estacion: null,
          fecha: '2026-11-30',
          detalle: 'Movilización',
        }),
      ],
      [existente('m', { tipo_actividad: 'movilizacion', estacion: null, detalle: 'Movilización' })],
    );
    expect(c.filas[0]).toMatchObject({ accion: 'cambio', item_id: 'm' });
  });

  it('el detalle distinto de una estación existente no es cambio de cronograma, se informa', () => {
    const c = compararProgramacion([resuelta(0, { detalle: 'Otra nota' })], [existente('a')]);
    expect(c.filas[0]).toMatchObject({ accion: 'sin_cambio', detalle_distinto: true });
  });

  it('RN-35 los cambios nunca eliminan: agregar, reprogramar o marcar', () => {
    const fila = {
      brigada_id: 'b2',
      fecha: '2026-12-09',
      tipo_actividad: 'estacion' as const,
      estacion_id: 'e1',
      detalle: null,
      actividad_especial: null,
      estado_fila: 'pendiente_validacion' as const,
    };
    expect(
      cambiosDeFilaComparada(
        { indice: 0, accion: 'nueva', item_id: null, detalle_distinto: false },
        fila,
        () => 'n1',
      ),
    ).toEqual([
      {
        tipo: 'agregar',
        item: {
          id: 'n1',
          brigada_id: 'b2',
          fecha: '2026-12-09',
          tipo_actividad: 'estacion',
          estacion_id: 'e1',
          detalle: null,
          actividad_especial: null,
          estado_fila: 'pendiente_validacion',
        },
      },
    ]);
    expect(
      cambiosDeFilaComparada(
        {
          indice: 0,
          accion: 'cambio',
          item_id: 'a',
          brigada: { antes: 'b1', despues: 'b2' },
          estado_fila: { antes: 'ok', despues: 'pendiente_validacion' },
          detalle_distinto: false,
        },
        fila,
        () => 'n1',
      ),
    ).toEqual([
      { tipo: 'reprogramar', item_id: 'a', fecha: '2026-12-09', brigada_id: 'b2' },
      { tipo: 'marcar', item_id: 'a', estado_fila: 'pendiente_validacion' },
    ]);
    expect(
      cambiosDeFilaComparada(
        { indice: 0, accion: 'sin_cambio', item_id: 'a', detalle_distinto: false },
        fila,
        () => 'n1',
      ),
    ).toEqual([]);
  });
});
