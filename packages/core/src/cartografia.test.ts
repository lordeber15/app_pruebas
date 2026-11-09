import { describe, expect, it } from 'vitest';
import {
  multiPoligonoSchema,
  puntoEnMultiPoligono,
  type CoordenadasMultiPoligono,
} from './cartografia.ts';
import { ESTACION_SELVA, ejecucion, metodoBase, ORIGEN, unidad } from './reglas/_fixtures.ts';
import { evaluarEjecucion } from './reglas/evaluador.ts';

/** Cuadrado de ~2,2 km alrededor de ORIGEN con un hueco pequeño al noreste. */
const CUADRADO: CoordenadasMultiPoligono = [
  [
    [
      [-77.05, -12.06],
      [-77.03, -12.06],
      [-77.03, -12.04],
      [-77.05, -12.04],
      [-77.05, -12.06],
    ],
    [
      [-77.035, -12.045],
      [-77.032, -12.045],
      [-77.032, -12.042],
      [-77.035, -12.042],
      [-77.035, -12.045],
    ],
  ],
];

describe('Polígonos del proyecto (KMZ, 2026-11-09)', () => {
  it('un punto dentro del polígono está dentro', () => {
    expect(puntoEnMultiPoligono(ORIGEN, CUADRADO)).toBe(true);
  });

  it('un punto fuera del polígono está fuera', () => {
    expect(puntoEnMultiPoligono({ lat: -12.1, lon: -77.04 }, CUADRADO)).toBe(false);
  });

  it('un punto en un hueco del polígono está fuera', () => {
    expect(puntoEnMultiPoligono({ lat: -12.0435, lon: -77.0335 }, CUADRADO)).toBe(false);
  });

  it('con varios polígonos basta estar en uno', () => {
    const otro: CoordenadasMultiPoligono = [
      ...CUADRADO,
      [
        [
          [-76, -11],
          [-75.9, -11],
          [-75.9, -10.9],
          [-76, -10.9],
          [-76, -11],
        ],
      ],
    ];
    expect(puntoEnMultiPoligono({ lat: -10.95, lon: -75.95 }, otro)).toBe(true);
  });

  it('rechaza un MultiPolygon con anillos de menos de 4 posiciones', () => {
    expect(
      multiPoligonoSchema.safeParse({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        ],
      }).success,
    ).toBe(false);
  });

  it('RN-31: una unidad fuera del polígono de su estación es advertencia, no obligatorio', () => {
    const e = evaluarEjecucion({
      metodo: metodoBase(),
      estacion: { ...ESTACION_SELVA, poligono: CUADRADO },
      ejecucion: ejecucion({
        unidades: [
          unidad({ id: 'u1', codigo: 'P-01', geometria: { tipo: 'punto', punto: ORIGEN } }),
          unidad({
            id: 'u2',
            codigo: 'P-02',
            geometria: { tipo: 'punto', punto: { lat: -12.2, lon: -77.04 } },
          }),
        ],
      }),
    });
    const fuera = e.resultados.filter(
      (r) => r.regla === 'dentro_poligono' && r.estado === 'incumple',
    );
    expect(fuera).toEqual([
      expect.objectContaining({ unidad_id: 'u2', tipo_control: 'advertencia' }),
    ]);
    expect(e.incumplimientos_obligatorios).toBe(0);
  });

  it('sin polígono asignado la regla no se evalúa', () => {
    const e = evaluarEjecucion({
      metodo: metodoBase(),
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({
        unidades: [unidad({ geometria: { tipo: 'punto', punto: { lat: 0, lon: 0 } } })],
      }),
    });
    expect(e.resultados.some((r) => r.regla === 'dentro_poligono')).toBe(false);
  });
});
