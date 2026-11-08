import { describe, expect, it } from 'vitest';
import { bboxDePuntos, bboxSchema, ladosBboxKm, validarAreaUsuario } from './mapas.ts';

describe('RF-M05 paquetes de mapa sin conexión', () => {
  it('el área de la brigada cubre sus estaciones con 5 km de margen', () => {
    const b = bboxDePuntos([
      { lat: -9.3, lon: -76.0 },
      { lat: -9.1, lon: -75.9 },
    ]);
    expect(b).not.toBeNull();
    const [o, s, e, n] = b ?? [0, 0, 0, 0];
    expect(o).toBeLessThan(-76.0);
    expect(e).toBeGreaterThan(-75.9);
    expect(s).toBeCloseTo(-9.3 - 5 / 111.32, 3);
    expect(n).toBeCloseTo(-9.1 + 5 / 111.32, 3);
  });

  it('sin estaciones no hay área', () => {
    expect(bboxDePuntos([])).toBeNull();
  });

  it('rechaza áreas invertidas', () => {
    expect(bboxSchema.safeParse([-75, -9, -76, -8]).success).toBe(false);
    expect(bboxSchema.safeParse([-76, -9, -75, -8]).success).toBe(true);
  });

  it('mide el área en km cerca del ecuador', () => {
    const { ancho, alto } = ladosBboxKm([-76, -9, -75.5, -8.5]);
    expect(alto).toBeCloseTo(55.66, 1);
    expect(ancho).toBeGreaterThan(54);
    expect(ancho).toBeLessThan(56);
  });

  it('V-10: un área de usuario mayor a 80 km por lado se rechaza', () => {
    expect(validarAreaUsuario([-76, -9, -75.5, -8.5]).ok).toBe(true);
    const r = validarAreaUsuario([-77, -10, -75, -8]);
    expect(r.ok).toBe(false);
  });
});
