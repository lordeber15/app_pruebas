import { describe, expect, it } from 'vitest';
import {
  ESTACION_COSTA,
  ESTACION_SELVA,
  ESTACION_SIN_REGION,
  ESTACION_ZA_EF,
  metodoBase,
  val,
} from './_fixtures.ts';
import { calcularAvance, esfuerzoEjecutado, esZaEf, resolverObjetivo } from './objetivo.ts';

describe('RN-32 y RN-38: objetivo aplicable y avance', () => {
  it('esZaEf: cualquier valor no nulo del atributo de A01 marca la estación como ZA/EF', () => {
    expect(esZaEf(ESTACION_ZA_EF)).toBe(true);
    expect(esZaEf({ za_ef: 'EF' })).toBe(true);
    expect(esZaEf(ESTACION_COSTA)).toBe(false);
  });

  it('D01 epífitas vasculares: 10 forófitos y 20 en ZA/EF, con la unidad del esfuerzo de D01', () => {
    const m = metodoBase({
      unidad: { tipo: 'arbol', tipos_adicionales: [], texto: null },
      esfuerzo: {
        estandar: { cantidad: 10, unidad: 'forófitos', texto: '10 árboles hospederos.' },
        za_ef: { cantidad: 20, texto: '20 árboles.' },
      },
      validaciones: [val.cantidad(10, 20)],
    });
    expect(resolverObjetivo(m, ESTACION_SELVA)).toEqual({
      cantidad: 10,
      medida: 'unidades',
      unidad_texto: 'forófitos',
      origen: 'd01',
      texto: '10 árboles hospederos.',
    });
    expect(resolverObjetivo(m, ESTACION_ZA_EF)).toMatchObject({
      cantidad: 20,
      origen: 'd01_za_ef',
      texto: '20 árboles.',
    });
  });

  it('D01 VES: región y ZA/EF por región; sin región, el mínimo general', () => {
    const m = metodoBase({
      validaciones: [
        val.cantidad(4, 8, {
          por_region: { COSTA: 8, SIERRA: 8, SELVA: 4 },
          za_ef_por_region: { COSTA: 16, SIERRA: 16, SELVA: 8 },
        }),
      ],
    });
    expect(resolverObjetivo(m, ESTACION_COSTA)).toMatchObject({
      cantidad: 8,
      origen: 'd01_region',
    });
    expect(resolverObjetivo(m, ESTACION_ZA_EF)).toMatchObject({
      cantidad: 16,
      origen: 'd01_za_ef_region',
    });
    expect(resolverObjetivo(m, ESTACION_SIN_REGION)).toMatchObject({ cantidad: 4, origen: 'd01' });
    expect(resolverObjetivo(m, { ...ESTACION_SIN_REGION, za_ef: 'ZA' })).toMatchObject({
      cantidad: 8,
      origen: 'd01_za_ef',
    });
  });

  it('D01 bofedales: referencia hasta que el especialista define el valor final en campo (CA-23)', () => {
    const m = metodoBase({
      unidad: { tipo: 'cuadrante', tipos_adicionales: [], texto: null },
      esfuerzo: {
        estandar: { cantidad: null, unidad: 'cuadrantes según superficie', texto: 'Referencia.' },
        za_ef: null,
      },
      validaciones: [val.referencia()],
    });
    expect(resolverObjetivo(m, ESTACION_ZA_EF)).toMatchObject({
      cantidad: null,
      origen: 'referencia',
      unidad_texto: 'cuadrantes según superficie',
    });
    expect(resolverObjetivo(m, ESTACION_ZA_EF, 9)).toMatchObject({ cantidad: 9, origen: 'campo' });
    expect(resolverObjetivo(m, ESTACION_ZA_EF, 0)).toMatchObject({ origen: 'referencia' });
    expect(resolverObjetivo(m, ESTACION_ZA_EF, Number.NaN)).toMatchObject({ origen: 'referencia' });
  });

  it('D01 ABS: el objetivo son 120 minutos', () => {
    const m = metodoBase({ validaciones: [val.tiempoEfectivo()] });
    expect(resolverObjetivo(m, ESTACION_SELVA)).toMatchObject({
      cantidad: 120,
      medida: 'minutos',
      origen: 'd01',
    });
  });

  it('sin regla en D01 no se inventa objetivo', () => {
    const m = metodoBase({ validaciones: [], esfuerzo: { estandar: null, za_ef: null } });
    expect(resolverObjetivo(m, ESTACION_SELVA)).toMatchObject({
      cantidad: null,
      origen: 'ninguno',
      unidad_texto: 'punto',
    });
    expect(resolverObjetivo(m, ESTACION_SELVA).texto).toContain('D01 no define');
  });

  it('calcularAvance: porcentaje con un decimal, sin tope, nulo sin objetivo (RN-38)', () => {
    const o = resolverObjetivo(metodoBase({ validaciones: [val.cantidad(3, 6)] }), ESTACION_COSTA);
    expect(calcularAvance(2, o)).toEqual({ ejecutado: 2, objetivo: 3, porcentaje: 66.7 });
    expect(calcularAvance(4, o)).toEqual({ ejecutado: 4, objetivo: 3, porcentaje: 133.3 });
    expect(
      calcularAvance(
        2,
        resolverObjetivo(metodoBase({ validaciones: [val.referencia()] }), ESTACION_COSTA),
      ),
    ).toEqual({ ejecutado: 2, objetivo: null, porcentaje: null });
  });

  it('RN-19 y RN-38: esfuerzoEjecutado cuenta unidades cerradas o los minutos de ABS de D01', () => {
    const cuadrantes = metodoBase({ validaciones: [val.cantidad(3, 6)] });
    const o = resolverObjetivo(cuadrantes, ESTACION_COSTA);
    expect(esfuerzoEjecutado(cuadrantes, o, { datos: {}, unidades_cerradas: 2 })).toBe(2);

    const abs = metodoBase({ validaciones: [val.tiempoEfectivo()] });
    const oAbs = resolverObjetivo(abs, ESTACION_COSTA);
    expect(oAbs.medida).toBe('minutos');
    expect(
      esfuerzoEjecutado(abs, oAbs, { datos: { tiempo_efectivo_min: '75' }, unidades_cerradas: 4 }),
    ).toBe(75);
    // Sin el dato no se inventa: 0 minutos de esa ejecución, nunca las unidades.
    expect(esfuerzoEjecutado(abs, oAbs, { datos: {}, unidades_cerradas: 4 })).toBe(0);
  });
});
