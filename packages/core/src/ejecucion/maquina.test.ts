import { describe, expect, it } from 'vitest';
import { ESTADOS_EJECUCION, type EstadoEjecucion } from '../estados.ts';
import { TRANSICIONES_EJECUCION, transicionarEjecucion, type AccionEjecucion } from './maquina.ts';

const acciones: readonly AccionEjecucion[] = [
  { tipo: 'cerrar' },
  { tipo: 'evaluar_qa', incumplimientosObligatorios: 0 },
  { tipo: 'validar', validacionActiva: true },
  { tipo: 'observar', validacionActiva: true, comentario: 'Falta la foto N' },
  { tipo: 'corregir' },
  { tipo: 'reabrir', motivo: 'Evidencia tardía relevante' },
];

describe('máquina de ejecución (RN-05, RN-31)', () => {
  it('todas las transiciones válidas e inválidas, estado por estado', () => {
    for (const estado of ESTADOS_EJECUCION) {
      for (const accion of acciones) {
        const r = transicionarEjecucion(estado, accion);
        const valida = TRANSICIONES_EJECUCION[accion.tipo].desde.includes(estado);
        expect(r.ok, `${estado} + ${accion.tipo}`).toBe(valida);
        if (!valida && !r.ok) expect(r.motivo).toBe('TRANSICION_INVALIDA');
      }
    }
  });

  it('RN-31: la QA post-sincronización solo marca parcial por requisitos obligatorios', () => {
    expect(
      transicionarEjecucion('evidencia_pendiente', {
        tipo: 'evaluar_qa',
        incumplimientosObligatorios: 0,
      }),
    ).toEqual({ ok: true, valor: 'completa' });
    expect(
      transicionarEjecucion('evidencia_pendiente', {
        tipo: 'evaluar_qa',
        incumplimientosObligatorios: 2,
      }),
    ).toEqual({ ok: true, valor: 'parcial' });
  });

  it('RN-06 (C1): validar u observar exige la validación humana activa', () => {
    expect(transicionarEjecucion('completa', { tipo: 'validar', validacionActiva: false })).toEqual(
      { ok: false, motivo: 'VALIDACION_INACTIVA' },
    );
    expect(
      transicionarEjecucion('parcial', {
        tipo: 'observar',
        validacionActiva: true,
        comentario: '  ',
      }),
    ).toEqual({ ok: false, motivo: 'COMENTARIO_OBLIGATORIO' });
  });

  it('RN-13: reabrir exige motivo y vuelve a en_curso', () => {
    expect(transicionarEjecucion('validada', { tipo: 'reabrir', motivo: '' })).toEqual({
      ok: false,
      motivo: 'MOTIVO_OBLIGATORIO',
    });
    expect(transicionarEjecucion('validada', { tipo: 'reabrir', motivo: 'x' })).toEqual({
      ok: true,
      valor: 'en_curso',
    });
  });

  it('E-06: una ejecución observada vuelve al celular para corregirla', () => {
    const observada = transicionarEjecucion('completa', {
      tipo: 'observar',
      validacionActiva: true,
      comentario: 'Repita',
    });
    expect(observada).toEqual({ ok: true, valor: 'observada' });
    expect(transicionarEjecucion('observada', { tipo: 'corregir' })).toEqual({
      ok: true,
      valor: 'en_curso',
    });
  });

  it('los estados de destino de cada acción existen en core', () => {
    const todos = new Set<string>(ESTADOS_EJECUCION);
    for (const t of Object.values(TRANSICIONES_EJECUCION)) {
      for (const h of t.hacia) expect(todos.has(h satisfies EstadoEjecucion)).toBe(true);
    }
  });
});
