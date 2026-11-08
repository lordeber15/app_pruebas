import { describe, expect, it } from 'vitest';
import { esEstadoArchivo, esEstadoReserva, esRolBrigada, esRolGlobal } from './estados.ts';
import { tieneTexto } from './resultado.ts';

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

describe('guardas de estado', () => {
  it('reconoce los estados de reserva y archivo válidos', () => {
    expect(esEstadoReserva('asignada')).toBe(true);
    expect(esEstadoReserva('descargada')).toBe(false);
    expect(esEstadoArchivo('preview_verificada')).toBe(true);
    expect(esEstadoArchivo('verificado')).toBe(false);
  });
});

describe('roles TOCE (ERS §2.2)', () => {
  it('separa los roles de brigada de los globales y descarta los del modelo anterior', () => {
    expect(esRolBrigada('supervisor_campo')).toBe(true);
    expect(esRolBrigada('jefe_brigada')).toBe(true);
    expect(esRolBrigada('logistico')).toBe(false);
    expect(esRolGlobal('jefe_proyecto')).toBe(true);
    expect(esRolGlobal('supervisor')).toBe(false);
    expect(esRolGlobal('especialista')).toBe(false);
  });
});
