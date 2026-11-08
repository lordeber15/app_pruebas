import { describe, expect, it } from 'vitest';
import { avanceEstacion, type MetodoEnEstacion } from './avance-estacion.ts';

const m = (
  porcentaje: number | null,
  ejecuciones: MetodoEnEstacion['ejecuciones'] = [],
): MetodoEnEstacion => ({
  metodo: 'x',
  avance: { ejecutado: 0, objetivo: porcentaje === null ? null : 1, porcentaje },
  ejecuciones,
});

describe('avance de la estación (métodos completos / aplicables, sin promedio P-11)', () => {
  it('RN-38: cuenta métodos completos, no promedia porcentajes', () => {
    const r = avanceEstacion([m(100, ['completa']), m(90, ['completa']), m(0)], {
      hoy: '2026-11-08',
    });
    expect(r).toMatchObject({ completos: 1, aplicables: 3, porcentaje: 33.3, estado: 'en_curso' });
  });

  it('sin objetivo numérico, una ejecución completa o validada completa el método', () => {
    const r = avanceEstacion([m(null, ['validada']), m(100, ['completa'])], { hoy: '2026-11-08' });
    expect(r).toMatchObject({ completos: 2, porcentaje: 100, estado: 'completa' });
  });

  it('una ejecución parcial marca la estación con incumplimiento', () => {
    const r = avanceEstacion([m(100, ['completa']), m(50, ['parcial'])], { hoy: '2026-11-08' });
    expect(r.estado).toBe('con_incumplimiento');
  });

  it('RN-37: sin ejecuciones no hay 0 %; programada para hoy o antes es «sin datos»', () => {
    const r = avanceEstacion([m(0), m(0)], { hoy: '2026-11-08', fechaProgramada: '2026-11-08' });
    expect(r).toMatchObject({ porcentaje: null, estado: 'sin_datos' });
  });

  it('programada a futuro sin ejecuciones queda «sin iniciar»', () => {
    const r = avanceEstacion([m(0)], { hoy: '2026-11-08', fechaProgramada: '2026-11-10' });
    expect(r.estado).toBe('sin_iniciar');
  });

  it('RN-35: reprogramada sin ejecuciones se muestra como reprogramada', () => {
    const r = avanceEstacion([m(0)], {
      hoy: '2026-11-08',
      fechaProgramada: '2026-11-01',
      reprogramada: true,
    });
    expect(r.estado).toBe('reprogramada');
  });

  it('sin métodos aplicables no hay porcentaje', () => {
    expect(avanceEstacion([], { hoy: '2026-11-08' })).toMatchObject({
      aplicables: 0,
      porcentaje: null,
      estado: 'sin_iniciar',
    });
  });
});
