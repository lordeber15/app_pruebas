import { describe, expect, it } from 'vitest';
import {
  estadoEnMatriz,
  evaluarCondicion,
  rechazoDeDecision,
  resolverAplicabilidad,
  type Aplicabilidad,
  type EstacionAplicabilidad,
} from './aplicabilidad.ts';

describe('RN-28 decisión nominal desde la web (P-01)', () => {
  it('RN-28 solo los CONDICIONAL admiten confirmar o descartar; TODAS y ABS son obligatorios', () => {
    expect(rechazoDeDecision('condicional')).toBeNull();
    expect(rechazoDeDecision('todas')).toBe('METODO_OBLIGATORIO');
    expect(rechazoDeDecision('transversal')).toBe('METODO_OBLIGATORIO');
    expect(rechazoDeDecision('evento')).toBe('DECISION_NO_APLICA');
    expect(rechazoDeDecision('atributo')).toBe('DECISION_NO_APLICA');
  });

  it('RN-28 estado en la matriz: descartado solo si es nominal; la condición que no se cumple es «no aplica»', () => {
    const fila = (habilitado: boolean, origen: Aplicabilidad['origen'], pendiente = false) => ({
      habilitado,
      origen,
      condicion_pendiente: pendiente,
    });
    expect(estadoEnMatriz('todas', fila(true, 'clase'))).toBe('aplicable');
    expect(estadoEnMatriz('condicional', fila(false, 'condicion', true))).toBe(
      'condicion_pendiente',
    );
    expect(estadoEnMatriz('condicional', fila(false, 'condicion'))).toBe('no_aplica');
    expect(estadoEnMatriz('condicional', fila(false, 'nominal'))).toBe('descartado');
    expect(estadoEnMatriz('condicional', fila(true, 'nominal'))).toBe('aplicable');
    expect(estadoEnMatriz('transversal', fila(false, 'clase'))).toBe('no_aplica');
    expect(estadoEnMatriz('evento', fila(true, 'clase'))).toBe('evento');
    expect(estadoEnMatriz('atributo', null)).toBe('atributo');
    expect(estadoEnMatriz('condicional', null)).toBe('condicion_pendiente');
  });
});

const costa: EstacionAplicabilidad = { region: 'COSTA', uv: 'Loma efímera', za_ef: null };
const selva: EstacionAplicabilidad = { region: 'SELVA', uv: 'Bosque de montaña', za_ef: null };
const laguna: EstacionAplicabilidad = {
  region: 'SIERRA',
  uv: 'Vegetación lacustre andina',
  za_ef: null,
};
const bofedal: EstacionAplicabilidad = { region: 'SIERRA', uv: 'Bofedal', za_ef: null };
const zaEf: EstacionAplicabilidad = {
  region: 'SELVA',
  uv: 'Zona agropecuaria amazónica',
  za_ef: 'ZA Cordillera Azul',
};
const sinRegion: EstacionAplicabilidad = { region: null, uv: 'Matorral', za_ef: null };

describe('RN-28 clases de aplicabilidad (E-01)', () => {
  it('TODAS se habilita en cualquier estación y nunca se oculta, ni por decisión nominal', () => {
    const r = resolverAplicabilidad({ clase: 'todas', condicion: null }, false, costa, {
      habilitado: false,
    });
    expect(r).toEqual({
      habilitado: true,
      origen: 'clase',
      condicion_pendiente: false,
      presentacion: 'metodo',
    });
  });

  it('EVENTO queda disponible como registro complementario sin reserva previa', () => {
    const r = resolverAplicabilidad({ clase: 'evento', condicion: null }, true, sinRegion);
    expect(r.habilitado).toBe(true);
    expect(r.presentacion).toBe('evento');
  });

  it('ATRIBUTO no aparece como método independiente', () => {
    const r = resolverAplicabilidad({ clase: 'atributo', condicion: null }, false, costa);
    expect(r.habilitado).toBe(false);
    expect(r.presentacion).toBe('oculto');
  });

  it('TRANSVERSAL (ABS) se habilita en toda estación de fauna y no en flora', () => {
    expect(
      resolverAplicabilidad({ clase: 'transversal', condicion: null }, true, costa).habilitado,
    ).toBe(true);
    expect(
      resolverAplicabilidad({ clase: 'transversal', condicion: null }, false, costa).habilitado,
    ).toBe(false);
  });

  it('CONDICIONAL por región: listas de 20 solo en selva', () => {
    const m = {
      clase: 'condicional' as const,
      condicion: { tipo: 'region' as const, regiones: ['SELVA' as const] },
    };
    expect(resolverAplicabilidad(m, true, selva).habilitado).toBe(true);
    expect(resolverAplicabilidad(m, true, costa).habilitado).toBe(false);
    const sin = resolverAplicabilidad(m, true, sinRegion);
    expect(sin.habilitado).toBe(false);
    expect(sin.condicion_pendiente).toBe(true);
  });

  it('CONDICIONAL región excepto UV: puntos de conteo en costa y sierra salvo lagos, lagunas y cochas', () => {
    const c = {
      tipo: 'region_excepto_uv' as const,
      regiones: ['COSTA' as const, 'SIERRA' as const],
      uv_excluida_contiene: ['lacustre', 'laguna', 'lago', 'cocha'],
    };
    expect(evaluarCondicion(c, costa)).toBe('cumple');
    expect(evaluarCondicion(c, laguna)).toBe('no_cumple');
    expect(evaluarCondicion(c, selva)).toBe('no_cumple');
  });

  it('CONDICIONAL por UV: bofedales, sin distinguir mayúsculas ni tildes', () => {
    const c = { tipo: 'uv_contiene' as const, fragmentos: ['bofedal'] };
    expect(evaluarCondicion(c, bofedal)).toBe('cumple');
    expect(evaluarCondicion(c, { ...bofedal, uv: 'BOFEDÁL altoandino' })).toBe('cumple');
    expect(evaluarCondicion(c, costa)).toBe('no_cumple');
    expect(evaluarCondicion(c, { ...costa, uv: null })).toBe('pendiente');
  });

  it('CONDICIONAL ZA/EF (RN-32): cumple solo si la estación tiene el atributo', () => {
    expect(evaluarCondicion({ tipo: 'za_ef' }, zaEf)).toBe('cumple');
    expect(evaluarCondicion({ tipo: 'za_ef' }, selva)).toBe('no_cumple');
    expect(evaluarCondicion({ tipo: 'za_ef_o_manual' }, selva)).toBe('pendiente');
  });

  it('CONDICIONAL manual (P-01) queda pendiente y deshabilitado hasta la decisión nominal', () => {
    const m = { clase: 'condicional' as const, condicion: { tipo: 'manual' as const } };
    const sinDecision = resolverAplicabilidad(m, false, costa);
    expect(sinDecision).toEqual({
      habilitado: false,
      origen: 'condicion',
      condicion_pendiente: true,
      presentacion: 'oculto',
    });
    const nominal = resolverAplicabilidad(m, false, costa, { habilitado: true });
    expect(nominal).toEqual({
      habilitado: true,
      origen: 'nominal',
      condicion_pendiente: false,
      presentacion: 'metodo',
    });
  });

  it('CONDICIONAL sin condición configurada se trata como pendiente, nunca como habilitado', () => {
    const r = resolverAplicabilidad({ clase: 'condicional', condicion: null }, false, costa);
    expect(r.habilitado).toBe(false);
    expect(r.condicion_pendiente).toBe(true);
  });
});
