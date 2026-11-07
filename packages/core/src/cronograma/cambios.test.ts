import { describe, expect, it } from 'vitest';
import {
  aplicarCambiosCronograma,
  cambioCronogramaSchema,
  impactoCronograma,
  type ItemCronograma,
} from './cambios.ts';

const id = (n: number): string => `0192f0c8-0000-7000-8000-${n.toString().padStart(12, '0')}`;
const B1 = id(1);
const B2 = id(2);
const E1 = id(11);
const E2 = id(12);

const base: readonly ItemCronograma[] = [
  {
    id: id(100),
    brigada_id: B1,
    fecha: '2026-12-02',
    tipo_actividad: 'movilizacion',
    estacion_id: null,
    detalle: 'Movilización',
    estado_fila: 'ok',
    actividad_especial: null,
  },
  {
    id: id(101),
    brigada_id: B1,
    fecha: '2026-12-03',
    tipo_actividad: 'estacion',
    estacion_id: E1,
    detalle: null,
    estado_fila: 'ok',
    actividad_especial: null,
  },
  {
    id: id(102),
    brigada_id: B1,
    fecha: '2026-12-04',
    tipo_actividad: 'estacion',
    estacion_id: E2,
    detalle: null,
    estado_fila: 'ok',
    actividad_especial: null,
  },
];

describe('RN-35 cronograma base y vigente', () => {
  it('reprogramar cambia fecha o brigada, marca la fila y conserva la estación', () => {
    const r = aplicarCambiosCronograma(base, [
      { tipo: 'reprogramar', item_id: id(101), fecha: '2026-12-06', brigada_id: B2 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const item = r.valor.find((i) => i.id === id(101));
    expect(item).toMatchObject({
      fecha: '2026-12-06',
      brigada_id: B2,
      estado_fila: 'reprogramada',
      estacion_id: E1,
    });
    expect(r.valor).toHaveLength(base.length);
    expect(base[1]?.fecha).toBe('2026-12-03'); // la entrada (versión anterior) no se muta
  });

  it('una estación no ejecutada nunca desaparece: no existe el cambio «eliminar»', () => {
    expect(cambioCronogramaSchema.safeParse({ tipo: 'eliminar', item_id: id(101) }).success).toBe(
      false,
    );
    const r = aplicarCambiosCronograma(base, [
      { tipo: 'marcar', item_id: id(102), estado_fila: 'sujeta_a_decision' },
      {
        tipo: 'agregar',
        item: {
          id: id(103),
          brigada_id: B2,
          fecha: '2026-12-09',
          tipo_actividad: 'estacion',
          estacion_id: E2,
          detalle: null,
          actividad_especial: null,
        },
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(impactoCronograma(base, r.valor).items_desaparecidos).toEqual([]);
    expect(r.valor.length).toBeGreaterThanOrEqual(base.length);
  });

  it('rechaza ítems inexistentes, ids repetidos y estaciones sin id', () => {
    expect(
      aplicarCambiosCronograma(base, [
        { tipo: 'reprogramar', item_id: id(999), fecha: '2026-12-06', brigada_id: null },
      ]),
    ).toEqual({ ok: false, motivo: 'ITEM_INEXISTENTE' });
    expect(
      aplicarCambiosCronograma(base, [
        {
          tipo: 'agregar',
          item: {
            id: id(100),
            brigada_id: B1,
            fecha: '2026-12-09',
            tipo_actividad: 'traslado',
            estacion_id: null,
            detalle: null,
            actividad_especial: null,
          },
        },
      ]),
    ).toEqual({ ok: false, motivo: 'ID_REPETIDO' });
    expect(
      aplicarCambiosCronograma(base, [
        {
          tipo: 'agregar',
          item: {
            id: id(104),
            brigada_id: B1,
            fecha: '2026-12-09',
            tipo_actividad: 'estacion',
            estacion_id: null,
            detalle: null,
            actividad_especial: null,
          },
        },
      ]),
    ).toEqual({ ok: false, motivo: 'ESTACION_SIN_ID' });
  });

  it('el impacto muestra estaciones y fechas afectadas para la decisión del JdP (D02 §10)', () => {
    const r = aplicarCambiosCronograma(base, [
      { tipo: 'reprogramar', item_id: id(102), fecha: '2026-12-07', brigada_id: null },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(impactoCronograma(base, r.valor)).toEqual({
      estaciones_afectadas: [E2],
      fechas_afectadas: ['2026-12-04', '2026-12-07'],
      items_desaparecidos: [],
    });
  });
});
