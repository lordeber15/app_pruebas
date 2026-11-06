import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { crearGeneradorUuidV7, instanteUuidV7 } from './uuid.ts';

const fija = (valor: number) => (n: number) => new Uint8Array(n).fill(valor);

describe('UUID v7', () => {
  it('RN-10 genera un UUID v7 válido', () => {
    const generar = crearGeneradorUuidV7(fija(0xff), () => 1_762_387_200_000);
    const id = generar();
    expect(z.uuidv7().safeParse(id).success).toBe(true);
    expect(id).toBe('019a5676-8800-7fff-bfff-ffffffffffff');
  });

  it('codifica el instante en los primeros 48 bits', () => {
    const ms = 1_762_387_200_123;
    expect(instanteUuidV7(crearGeneradorUuidV7(fija(0), () => ms)())).toBe(ms);
  });

  it('ordena por tiempo', () => {
    let t = 1_000;
    const generar = crearGeneradorUuidV7(fija(0x80), () => t++);
    const ids = [generar(), generar(), generar()];
    expect([...ids].sort()).toEqual(ids);
  });

  it.each([-1, Number.NaN, 2 ** 53])('rechaza una hora inválida (%s)', (ms) => {
    expect(() => crearGeneradorUuidV7(fija(0), () => ms)()).toThrow(RangeError);
  });

  it('rechaza una fuente aleatoria insuficiente', () => {
    expect(() => crearGeneradorUuidV7(() => new Uint8Array(4))()).toThrow(RangeError);
  });
});
