import { describe, expect, it } from 'vitest';
import { metodoBase, mover, ORIGEN } from './_fixtures.ts';
import {
  distanciaM,
  geometriaRequerida,
  puntoRepresentativo,
  separacionMinima,
  verificarGeometria,
} from './geometria.ts';

describe('RN-30 geometría: utilidades', () => {
  it('distanciaM: 100 m al norte y 100 m al este miden ~100 m; el mismo punto mide 0', () => {
    expect(distanciaM(ORIGEN, mover(ORIGEN, 100, 0))).toBeCloseTo(100, 0);
    expect(distanciaM(ORIGEN, mover(ORIGEN, 0, 100))).toBeCloseTo(100, 0);
    expect(distanciaM(ORIGEN, ORIGEN)).toBe(0);
    // 0,001° de latitud ≈ 111 m en cualquier longitud.
    expect(distanciaM({ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 })).toBeCloseTo(111.2, 0);
  });

  it('puntoRepresentativo: punto, inicio de la línea, centroide de la parcela; nulo sin geometría', () => {
    expect(puntoRepresentativo(null)).toBeNull();
    expect(puntoRepresentativo({ tipo: 'punto', punto: ORIGEN })).toEqual(ORIGEN);
    expect(
      puntoRepresentativo({ tipo: 'inicio_fin', inicio: ORIGEN, fin: mover(ORIGEN, 100, 0) }),
    ).toEqual(ORIGEN);
    const c = puntoRepresentativo({
      tipo: 'vertices',
      vertices: [ORIGEN, mover(ORIGEN, 0, 10), mover(ORIGEN, 10, 10), mover(ORIGEN, 10, 0)],
    });
    expect(c).not.toBeNull();
    if (c !== null) expect(distanciaM(c, mover(ORIGEN, 5, 5))).toBeLessThan(0.5);
    expect(puntoRepresentativo({ tipo: 'vertices', vertices: [] })).toBeNull();
    const f = puntoRepresentativo({
      tipo: 'parcela_forestal',
      principal: [ORIGEN, mover(ORIGEN, 0, 20)],
      subparcelas: [],
    });
    expect(f).not.toBeNull();
    if (f !== null) expect(distanciaM(f, mover(ORIGEN, 0, 10))).toBeLessThan(0.5);
  });

  it('separacionMinima devuelve el par más cercano y nulo con menos de dos puntos', () => {
    expect(separacionMinima([])).toBeNull();
    expect(separacionMinima([{ id: 'a', punto: ORIGEN }])).toBeNull();
    const s = separacionMinima([
      { id: 'a', punto: ORIGEN },
      { id: 'b', punto: mover(ORIGEN, 0, 300) },
      { id: 'c', punto: mover(ORIGEN, 0, 340) },
    ]);
    expect(s).toMatchObject({ a: 'b', b: 'c' });
    expect(s?.metros).toBeCloseTo(40, 0);
  });

  it('geometriaRequerida: la principal del método, la de `por_tipo` para adicionales, nula para otras', () => {
    const m = metodoBase({
      unidad: { tipo: 'trampa', tipos_adicionales: ['transecto'], texto: null },
      geometria: {
        tipo: 'punto_opcional',
        texto: '',
        vinculo_metodo: null,
        por_tipo: { transecto: 'inicio_fin' },
        detalle: null,
      },
    });
    expect(geometriaRequerida(m, 'trampa')).toBe('punto_opcional');
    expect(geometriaRequerida(m, 'transecto')).toBe('inicio_fin');
    expect(geometriaRequerida(m, 'cuadrante')).toBeNull();
  });

  it('verificarGeometria cubre cada tipo de D01 (E-04)', () => {
    const m = metodoBase({
      geometria: {
        tipo: 'vertices',
        texto: '',
        vinculo_metodo: null,
        detalle: { vertices_minimos: 4 },
      },
    });
    const punto = { tipo: 'punto', punto: ORIGEN } as const;
    const linea = { tipo: 'inicio_fin', inicio: ORIGEN, fin: mover(ORIGEN, 10, 0) } as const;
    expect(verificarGeometria(m, 'hereda', null)).toBeNull();
    expect(verificarGeometria(m, 'vinculada', null)).toBeNull();
    expect(verificarGeometria(m, 'punto_opcional', null)).toBeNull();
    expect(verificarGeometria(m, 'punto_opcional', linea)).toBe('TIPO_DISTINTO');
    expect(verificarGeometria(m, 'punto', null)).toBe('SIN_GEOMETRIA');
    expect(verificarGeometria(m, 'punto', linea)).toBe('TIPO_DISTINTO');
    expect(verificarGeometria(m, 'punto', punto)).toBeNull();
    expect(verificarGeometria(m, 'inicio_fin', null)).toBe('SIN_GEOMETRIA');
    expect(verificarGeometria(m, 'inicio_fin', punto)).toBe('TIPO_DISTINTO');
    expect(verificarGeometria(m, 'inicio_fin', linea)).toBeNull();
    expect(verificarGeometria(m, 'vertices', null)).toBe('SIN_GEOMETRIA');
    expect(verificarGeometria(m, 'vertices', punto)).toBe('TIPO_DISTINTO');
    expect(
      verificarGeometria(m, 'vertices', { tipo: 'vertices', vertices: [ORIGEN, ORIGEN, ORIGEN] }),
    ).toBe('VERTICES_INSUFICIENTES');
    expect(
      verificarGeometria(m, 'vertices', {
        tipo: 'vertices',
        vertices: [ORIGEN, ORIGEN, ORIGEN, ORIGEN],
      }),
    ).toBeNull();
    expect(verificarGeometria(m, 'parcela_forestal', null)).toBe('SIN_GEOMETRIA');
    expect(verificarGeometria(m, 'parcela_forestal', punto)).toBe('TIPO_DISTINTO');
    expect(
      verificarGeometria(m, 'parcela_forestal', {
        tipo: 'parcela_forestal',
        principal: [ORIGEN],
        subparcelas: [],
      }),
    ).toBe('VERTICES_INSUFICIENTES');
  });

  it('sin `vertices_minimos` en D01 se exigen 3 (polígono mínimo) y sin subparcelas definidas no se exigen', () => {
    const m = metodoBase({
      geometria: { tipo: 'parcela_forestal', texto: '', vinculo_metodo: null, detalle: null },
    });
    const tri = [ORIGEN, mover(ORIGEN, 0, 10), mover(ORIGEN, 10, 0)];
    expect(verificarGeometria(m, 'vertices', { tipo: 'vertices', vertices: tri })).toBeNull();
    expect(
      verificarGeometria(m, 'parcela_forestal', {
        tipo: 'parcela_forestal',
        principal: tri,
        subparcelas: [],
      }),
    ).toBeNull();
    const conSub = metodoBase({
      geometria: {
        tipo: 'parcela_forestal',
        texto: '',
        vinculo_metodo: null,
        detalle: { subparcelas: [{ tipo: 'latizales', cantidad: 1, dimensiones: '10 × 10 m' }] },
      },
    });
    expect(
      verificarGeometria(conSub, 'parcela_forestal', {
        tipo: 'parcela_forestal',
        principal: tri,
        subparcelas: [{ tipo: 'latizales', vertices: [ORIGEN, ORIGEN] }],
      }),
    ).toBe('SUBPARCELAS_INCOMPLETAS');
    expect(
      verificarGeometria(conSub, 'parcela_forestal', {
        tipo: 'parcela_forestal',
        principal: tri,
        subparcelas: [{ tipo: 'latizales', vertices: tri }],
      }),
    ).toBeNull();
  });
});
