import { describe, expect, it } from 'vitest';
import { ESTADOS_ASIGNACION } from '../estados.ts';
import { transicionarAsignacion, type AccionAsignacion } from './maquina.ts';

const acciones: readonly AccionAsignacion[] = [
  { tipo: 'finalizar' },
  { tipo: 'devolver' },
  { tipo: 'revocar', motivo: 'Reasignación por enfermedad' },
];

describe('máquina de estados de la asignación (doc. 02 §7.2)', () => {
  it.each([
    ['finalizar', 'finalizada'],
    ['devolver', 'devuelta'],
    ['revocar', 'revocada'],
  ] as const)('vigente --%s--> %s', (tipo, hacia) => {
    const accion = acciones.find((a) => a.tipo === tipo);
    if (accion === undefined) throw new Error('acción no definida');
    expect(transicionarAsignacion('vigente', accion)).toEqual({ ok: true, valor: hacia });
  });

  const finales = ESTADOS_ASIGNACION.filter((e) => e !== 'vigente');
  it.each(finales.flatMap((estado) => acciones.map((a) => [estado, a] as const)))(
    'RN-08 una asignación %s no cambia de estado',
    (estado, accion) => {
      expect(transicionarAsignacion(estado, accion)).toEqual({
        ok: false,
        motivo: 'ASIGNACION_NO_VIGENTE',
      });
    },
  );

  it('RN-07 CP-032 revocar exige motivo', () => {
    expect(transicionarAsignacion('vigente', { tipo: 'revocar', motivo: '' })).toEqual({
      ok: false,
      motivo: 'MOTIVO_OBLIGATORIO',
    });
  });
});
