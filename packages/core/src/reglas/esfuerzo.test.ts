import { describe, expect, it } from 'vitest';
import { eventoSchema } from '../eventos/esquemas.ts';
import { interrupcionSchema, resumirEsfuerzo, type Interrupcion } from './esfuerzo.ts';
import type { Objetivo } from './tipos.ts';

const objetivo = (cantidad: number | null): Objetivo => ({
  cantidad,
  medida: 'unidades',
  unidad_texto: 'puntos de conteo',
  origen: cantidad === null ? 'referencia' : 'd01',
  texto: 'x',
});

const interrupcion = (
  inicio: string,
  fin: string | null,
  tipo: Interrupcion['tipo'] = 'interrupcion',
): Interrupcion => ({
  id: '0190f0e0-0000-7000-8000-000000000001',
  tipo,
  motivo: 'Lluvia fuerte',
  inicio,
  fin,
  unidad_id: null,
});

describe('RF-T05 / T-10 esfuerzo planificado vs. ejecutado', () => {
  it('T-10: guarda inicio y fin con la primera unidad y el último fin', () => {
    const r = resumirEsfuerzo({
      objetivo: objetivo(10),
      ejecutado: 8,
      abierta_en: '2026-11-08T12:00:00Z',
      cerrada_en: '2026-11-08T15:00:00Z',
      unidades: [
        { inicio: '2026-11-08T11:50:00Z', fin: '2026-11-08T12:30:00Z' },
        { inicio: '2026-11-08T13:00:00Z', fin: '2026-11-08T15:10:00Z' },
      ],
      interrupciones: [],
    });
    expect(r.ejecutado.inicio).toBe('2026-11-08T11:50:00.000Z');
    expect(r.ejecutado.fin).toBe('2026-11-08T15:10:00.000Z');
    expect(r.ejecutado.duracion_min).toBe(200);
    expect(r.planificado.cantidad).toBe(10);
    expect(r.diferencia).toBe(-2);
  });

  it('T-10: las interrupciones descuentan tiempo sin contar dos veces los solapes', () => {
    const r = resumirEsfuerzo({
      objetivo: objetivo(5),
      ejecutado: 5,
      abierta_en: '2026-11-08T12:00:00Z',
      cerrada_en: '2026-11-08T14:00:00Z',
      unidades: [],
      interrupciones: [
        interrupcion('2026-11-08T12:30:00Z', '2026-11-08T13:00:00Z'),
        interrupcion('2026-11-08T12:45:00Z', '2026-11-08T13:15:00Z', 'falla'),
      ],
    });
    expect(r.ejecutado.interrumpido_min).toBe(45);
    expect(r.ejecutado.efectivo_min).toBe(75);
    expect(r.ejecutado.interrupciones).toBe(1);
    expect(r.ejecutado.fallas).toBe(1);
  });

  it('T-10: una interrupción sin reanudar cuenta hasta el cierre', () => {
    const r = resumirEsfuerzo({
      objetivo: objetivo(5),
      ejecutado: 2,
      abierta_en: '2026-11-08T12:00:00Z',
      cerrada_en: '2026-11-08T13:00:00Z',
      unidades: [],
      interrupciones: [interrupcion('2026-11-08T12:40:00Z', null, 'falla')],
    });
    expect(r.ejecutado.interrumpido_min).toBe(20);
    expect(r.ejecutado.efectivo_min).toBe(40);
  });

  it('RN-38: sin objetivo numérico (referencia de campo) no hay diferencia', () => {
    const r = resumirEsfuerzo({
      objetivo: objetivo(null),
      ejecutado: 3,
      abierta_en: '2026-11-08T12:00:00Z',
      cerrada_en: null,
      unidades: [],
      interrupciones: [],
    });
    expect(r.diferencia).toBeNull();
    expect(r.ejecutado.fin).toBeNull();
    expect(r.ejecutado.duracion_min).toBeNull();
  });

  it('T-10: una interrupción exige motivo y un fin posterior al inicio', () => {
    expect(
      interrupcionSchema.safeParse({ ...interrupcion('2026-11-08T12:00:00Z', null), motivo: ' ' })
        .success,
    ).toBe(false);
    expect(
      interrupcionSchema.safeParse(interrupcion('2026-11-08T12:00:00Z', '2026-11-08T11:00:00Z'))
        .success,
    ).toBe(false);
  });

  it('compatibilidad N−1: un cierre sin interrupciones se acepta con lista vacía', () => {
    const r = eventoSchema.safeParse({
      id: '0190f0e0-0000-7000-8000-000000000002',
      tipo: 'ejecucion_cerrada',
      version_esquema: 1,
      entidad: { tipo: 'ejecucion', id: '0190f0e0-0000-7000-8000-000000000003' },
      hora_dispositivo: '2026-11-08T12:00:00Z',
      ubicacion: null,
      payload: {
        ejecucion_id: '0190f0e0-0000-7000-8000-000000000003',
        cerrada_en: '2026-11-08T12:00:00Z',
        datos: {},
        desviacion: { tipo: 'ninguna', explicacion: null },
        confirmaciones: [],
        objetivo_campo: null,
        archivo_ids: [],
      },
    });
    if (!r.success) throw new Error(JSON.stringify(r.error.issues));
    expect(r.data.tipo === 'ejecucion_cerrada' && r.data.payload.interrupciones).toEqual([]);
  });
});
