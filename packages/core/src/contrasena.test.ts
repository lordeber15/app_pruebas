import { describe, expect, it } from 'vitest';
import {
  cambioContrasenaSchema,
  contrasenaSchema,
  cumpleContrasena,
  generarContrasenaTemporal,
  REQUISITOS_CONTRASENA,
} from './contrasena.ts';

const azar = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

describe('política de contraseñas (8 caracteres, mayúscula, minúscula y número)', () => {
  it.each([
    ['Campo2026', true],
    ['Ñandú123', true],
    ['Abcdefg1', true],
    ['Abcdef1', false], // 7 caracteres
    ['abcdefg1', false], // sin mayúscula
    ['ABCDEFG1', false], // sin minúscula
    ['Abcdefgh', false], // sin número
    ['', false],
  ])('%j cumple = %s', (c, esperado) => {
    expect(cumpleContrasena(c)).toBe(esperado);
    expect(contrasenaSchema.safeParse(c).success).toBe(esperado);
  });

  it('dice qué falta, en el orden en que se muestran los requisitos', () => {
    const r = contrasenaSchema.safeParse('abc');
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      'Falta: al menos 8 caracteres',
      'Falta: una letra mayúscula',
      'Falta: un número',
    ]);
    expect(REQUISITOS_CONTRASENA.map((x) => x.clave)).toEqual([
      'largo',
      'mayuscula',
      'minuscula',
      'numero',
    ]);
  });

  it('rechaza más de 128 caracteres', () => {
    expect(cumpleContrasena(`Aa1${'x'.repeat(126)}`)).toBe(false);
  });

  it('la nueva debe ser distinta de la actual', () => {
    expect(
      cambioContrasenaSchema.safeParse({ actual: 'Campo2026', nueva: 'Campo2026' }).success,
    ).toBe(false);
    expect(cambioContrasenaSchema.safeParse({ actual: 'x', nueva: 'Campo2027' }).success).toBe(
      true,
    );
  });
});

describe('contraseña temporal', () => {
  it('siempre cumple la política y tiene el largo pedido', () => {
    for (let i = 0; i < 500; i++) {
      const c = generarContrasenaTemporal(azar);
      expect(c).toHaveLength(12);
      expect(cumpleContrasena(c)).toBe(true);
    }
    expect(generarContrasenaTemporal(azar, 14)).toHaveLength(14);
    expect(generarContrasenaTemporal(azar, 4)).toHaveLength(8);
  });

  it('no usa caracteres que se confunden al dictarla', () => {
    for (let i = 0; i < 200; i++) expect(generarContrasenaTemporal(azar)).not.toMatch(/[0O1lI]/);
  });

  it('descarta los bytes que sesgarían el resultado', () => {
    // Primero bytes ≥ el tope (se descartan), luego 0: elige el primer carácter de cada alfabeto.
    let llamadas = 0;
    const sesgado = (n: number) => {
      llamadas++;
      return new Uint8Array(n).fill(llamadas % 2 === 1 ? 255 : 0);
    };
    expect(cumpleContrasena(generarContrasenaTemporal(sesgado, 8))).toBe(true);
  });
});
