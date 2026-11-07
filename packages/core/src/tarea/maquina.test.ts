import { describe, expect, it } from 'vitest';
import { ESTADOS_TAREA, type EstadoTarea } from '../estados.ts';
import { transicionarTarea, type AccionTarea, type TipoAccionTarea } from './maquina.ts';

/** Acción con todas sus condiciones cumplidas, para probar solo la transición. */
const accionValida: Readonly<Record<TipoAccionTarea, AccionTarea>> = {
  asignar: { tipo: 'asignar' },
  reasignar: { tipo: 'reasignar' },
  descargar: { tipo: 'descargar' },
  devolver: { tipo: 'devolver' },
  revocar: { tipo: 'revocar', motivo: 'Cambio de brigada' },
  completar: { tipo: 'completar', fotosAnunciadas: 1 },
  verificar_evidencia: { tipo: 'verificar_evidencia', fotosVerificadas: 1 },
  validar: { tipo: 'validar', validacionActiva: true },
  observar: { tipo: 'observar', validacionActiva: true },
  redescargar: { tipo: 'redescargar' },
  reabrir: { tipo: 'reabrir', motivo: 'Falta la foto del transecto' },
  cerrar: { tipo: 'cerrar', origen: 'regla', comentario: 'Verificado por radio' },
};

/**
 * Transiciones válidas copiadas a mano del diagrama de doc. 02 §7.1 (no de la implementación).
 * Cualquier combinación que no esté aquí debe rechazarse.
 */
const ESPERADAS: readonly (readonly [EstadoTarea, TipoAccionTarea, EstadoTarea])[] = [
  ['pendiente', 'asignar', 'asignada'],
  ['asignada', 'reasignar', 'asignada'],
  ['asignada', 'descargar', 'descargada'],
  ['descargada', 'devolver', 'asignada'],
  ['descargada', 'revocar', 'asignada'],
  ['descargada', 'completar', 'en_transito'],
  ['en_transito', 'verificar_evidencia', 'completada'],
  ['completada', 'validar', 'validada'],
  ['completada', 'observar', 'observada'],
  ['observada', 'redescargar', 'descargada'],
  ['completada', 'reabrir', 'asignada'],
  ['validada', 'reabrir', 'asignada'],
  ['asignada', 'cerrar', 'cerrada'],
];

const tiposAccion = Object.keys(accionValida) as TipoAccionTarea[];
const combinaciones = ESTADOS_TAREA.flatMap((estado) =>
  tiposAccion.map((tipo) => [estado, tipo] as const),
);

describe('máquina de estados de la tarea (doc. 02 §7.1)', () => {
  it.each(ESPERADAS)('transición válida: %s --%s--> %s', (desde, tipo, hacia) => {
    expect(transicionarTarea(desde, accionValida[tipo])).toEqual({ ok: true, valor: hacia });
  });

  const invalidas = combinaciones.filter(
    ([estado, tipo]) => !ESPERADAS.some(([d, t]) => d === estado && t === tipo),
  );

  it.each(invalidas)('RN-12 transición inválida: %s --%s--> rechazada', (estado, tipo) => {
    const r = transicionarTarea(estado, accionValida[tipo]);
    expect(r.ok).toBe(false);
  });

  it('cubre todas las combinaciones de estado y acción', () => {
    expect(ESPERADAS.length + invalidas.length).toBe(ESTADOS_TAREA.length * tiposAccion.length);
  });

  it.each(tiposAccion)('una tarea cerrada no admite "%s" (TAREA_CERRADA)', (tipo) => {
    expect(transicionarTarea('cerrada', accionValida[tipo])).toEqual({
      ok: false,
      motivo: 'TAREA_CERRADA',
    });
  });

  it('una transición inválida informa TRANSICION_INVALIDA', () => {
    expect(transicionarTarea('pendiente', accionValida.completar)).toEqual({
      ok: false,
      motivo: 'TRANSICION_INVALIDA',
    });
  });
});

describe('condiciones de las transiciones', () => {
  it('RN-04 CP-011 completar sin foto se rechaza', () => {
    expect(transicionarTarea('descargada', { tipo: 'completar', fotosAnunciadas: 0 })).toEqual({
      ok: false,
      motivo: 'SIN_FOTO',
    });
  });

  it('RN-05 CP-025 la tarea queda en tránsito hasta verificar al menos una foto', () => {
    expect(
      transicionarTarea('en_transito', { tipo: 'verificar_evidencia', fotosVerificadas: 0 }),
    ).toEqual({
      ok: false,
      motivo: 'EVIDENCIA_NO_VERIFICADA',
    });
  });

  it('RN-07 CP-031 una tarea retenida no se reasigna sin revocar', () => {
    expect(transicionarTarea('descargada', { tipo: 'reasignar' })).toEqual({
      ok: false,
      motivo: 'TAREA_RETENIDA',
    });
  });

  it.each(['', '   '])('RN-07 CP-032 revocar sin motivo ("%s") se rechaza', (motivo) => {
    expect(transicionarTarea('descargada', { tipo: 'revocar', motivo })).toEqual({
      ok: false,
      motivo: 'MOTIVO_OBLIGATORIO',
    });
  });

  it('RN-07 CP-030 una tarea devuelta vuelve a asignada y se puede reasignar', () => {
    const devuelta = transicionarTarea('descargada', { tipo: 'devolver' });
    expect(devuelta).toEqual({ ok: true, valor: 'asignada' });
    expect(transicionarTarea('asignada', { tipo: 'reasignar' }).ok).toBe(true);
  });

  it('RN-13 reabrir exige motivo', () => {
    expect(transicionarTarea('validada', { tipo: 'reabrir', motivo: ' ' })).toEqual({
      ok: false,
      motivo: 'MOTIVO_OBLIGATORIO',
    });
  });

  it.each(['validar', 'observar'] as const)(
    'RN-06 CP-035 sin validación activa la tarea completada no se puede %s',
    (tipo) => {
      expect(transicionarTarea('completada', { tipo, validacionActiva: false })).toEqual({
        ok: false,
        motivo: 'VALIDACION_INACTIVA',
      });
    },
  );

  it('RN-04 CP-056 solo se cierra en la web una tarea por regla', () => {
    expect(
      transicionarTarea('asignada', { tipo: 'cerrar', origen: 'manual', comentario: 'Sin acceso' }),
    ).toEqual({ ok: false, motivo: 'SOLO_TAREA_POR_REGLA' });
  });

  it('RN-04 CP-056 cerrar una tarea por regla exige comentario', () => {
    expect(
      transicionarTarea('asignada', { tipo: 'cerrar', origen: 'regla', comentario: '' }),
    ).toEqual({
      ok: false,
      motivo: 'COMENTARIO_OBLIGATORIO',
    });
  });

  it('RN-13 la evidencia tardía no reabre una tarea cerrada', () => {
    expect(transicionarTarea('cerrada', { tipo: 'completar', fotosAnunciadas: 3 })).toEqual({
      ok: false,
      motivo: 'TAREA_CERRADA',
    });
  });
});
