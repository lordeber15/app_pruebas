import { describe, expect, it } from 'vitest';
import {
  avanceEsfuerzo,
  esfuerzoPorUsuario,
  totalEsfuerzo,
  type RegistroEsfuerzo,
} from './esfuerzo';
import { tieneTexto } from './resultado';
import { validacionEfectiva } from './validacion';

describe('validación efectiva', () => {
  it('CP-036 el cuaderno con validación prevalece sobre un proyecto sin validación', () => {
    expect(validacionEfectiva(true, false)).toBe(true);
  });

  it('CP-036 el cuaderno sin validación prevalece sobre un proyecto con validación', () => {
    expect(validacionEfectiva(false, true)).toBe(false);
  });

  it.each([true, false])('RN-06 el cuaderno sin valor hereda el del proyecto (%s)', (proyecto) => {
    expect(validacionEfectiva(null, proyecto)).toBe(proyecto);
  });
});

describe('esfuerzo compartido', () => {
  const em = 'em-1';
  const registros: RegistroEsfuerzo[] = [
    { estacionMetodologiaId: em, usuarioId: 'ana', cantidad: 3 },
    { estacionMetodologiaId: em, usuarioId: 'luis', cantidad: 2 },
    { estacionMetodologiaId: em, usuarioId: 'ana', cantidad: 1.5 },
    { estacionMetodologiaId: 'otra', usuarioId: 'ana', cantidad: 10 },
    { estacionMetodologiaId: em, usuarioId: 'luis', cantidad: Number.NaN },
    { estacionMetodologiaId: em, usuarioId: 'luis', cantidad: -4 },
  ];

  it('RN-19 CP-016 el total es la suma de las filas de todos los usuarios', () => {
    expect(totalEsfuerzo(registros, em)).toBe(6.5);
  });

  it('RN-19 CP-016 el esfuerzo de cada usuario se conserva por separado', () => {
    expect(Object.fromEntries(esfuerzoPorUsuario(registros, em))).toEqual({ ana: 4.5, luis: 2 });
  });

  it('calcula el avance contra la meta', () => {
    expect(avanceEsfuerzo(6.5, 10)).toEqual({ total: 6.5, meta: 10, porcentaje: 65 });
    expect(avanceEsfuerzo(12, 10).porcentaje).toBe(120);
  });

  it.each([null, 0])('sin meta (%s) no hay porcentaje', (meta) => {
    expect(avanceEsfuerzo(5, meta).porcentaje).toBeNull();
  });
});

describe('textos obligatorios', () => {
  it.each([
    [null, false],
    [undefined, false],
    ['', false],
    ['  \n', false],
    ['motivo', true],
  ] as const)('tieneTexto(%j) = %s', (texto, esperado) => {
    expect(tieneTexto(texto)).toBe(esperado);
  });
});
