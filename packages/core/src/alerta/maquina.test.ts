import { describe, expect, it } from 'vitest';
import { ESTADOS_ALERTA, ESTADOS_SOLICITUD_CRONOGRAMA } from '../estados.ts';
import {
  complementarAlerta,
  TRANSICIONES_ALERTA,
  TRANSICIONES_SOLICITUD_CRONOGRAMA,
  transicionarAlerta,
  transicionarSolicitudCronograma,
  type AccionAlerta,
  type AccionSolicitudCronograma,
} from './maquina.ts';

describe('RN-36 alertas: estados mínimos', () => {
  const acciones: readonly AccionAlerta[] = [
    { tipo: 'consultar' },
    { tipo: 'responder', texto: 'La trampa 3 se repuso' },
    { tipo: 'cerrar', comentario: null },
    { tipo: 'reabrir', motivo: 'Nueva evidencia' },
  ];

  it('todas las transiciones válidas e inválidas', () => {
    for (const estado of ESTADOS_ALERTA) {
      for (const a of acciones) {
        const r = transicionarAlerta(estado, a);
        expect(r.ok, `${estado} + ${a.tipo}`).toBe(
          TRANSICIONES_ALERTA[a.tipo].desde.includes(estado),
        );
      }
    }
  });

  it('abierta → pendiente de respuesta → abierta → cerrada', () => {
    expect(transicionarAlerta('abierta', { tipo: 'consultar' })).toEqual({
      ok: true,
      valor: 'pendiente_respuesta',
    });
    expect(transicionarAlerta('pendiente_respuesta', { tipo: 'responder', texto: 'ok' })).toEqual({
      ok: true,
      valor: 'abierta',
    });
    expect(transicionarAlerta('abierta', { tipo: 'cerrar', comentario: 'Resuelto' })).toEqual({
      ok: true,
      valor: 'cerrada',
    });
  });

  it('responder exige texto y reabrir exige motivo', () => {
    expect(transicionarAlerta('abierta', { tipo: 'responder', texto: ' ' })).toEqual({
      ok: false,
      motivo: 'TEXTO_OBLIGATORIO',
    });
    expect(transicionarAlerta('cerrada', { tipo: 'reabrir', motivo: '' })).toEqual({
      ok: false,
      motivo: 'MOTIVO_OBLIGATORIO',
    });
  });
});

describe('RN-36 solicitud de cambio de cronograma (E-08)', () => {
  const acciones: readonly AccionSolicitudCronograma[] = [
    { tipo: 'aprobar' },
    { tipo: 'rechazar', comentario: 'No hay movilidad' },
    { tipo: 'pedir_ajuste', comentario: 'Mover un día más' },
    { tipo: 'ajustar' },
  ];

  it('todas las transiciones válidas e inválidas', () => {
    for (const estado of ESTADOS_SOLICITUD_CRONOGRAMA) {
      for (const a of acciones) {
        const r = transicionarSolicitudCronograma(estado, a);
        expect(r.ok, `${estado} + ${a.tipo}`).toBe(
          TRANSICIONES_SOLICITUD_CRONOGRAMA[a.tipo].desde.includes(estado),
        );
      }
    }
  });

  it('rechazar y pedir ajuste exigen comentario; una aprobada o rechazada es final', () => {
    expect(
      transicionarSolicitudCronograma('pendiente', { tipo: 'rechazar', comentario: '' }),
    ).toEqual({ ok: false, motivo: 'COMENTARIO_OBLIGATORIO' });
    expect(transicionarSolicitudCronograma('aprobada', { tipo: 'ajustar' }).ok).toBe(false);
    expect(transicionarSolicitudCronograma('rechazada', { tipo: 'aprobar' }).ok).toBe(false);
    expect(transicionarSolicitudCronograma('ajuste_solicitado', { tipo: 'ajustar' })).toEqual({
      ok: true,
      valor: 'pendiente',
    });
  });
});

describe('RN-36 alertas: complementar sin cambiar el estado', () => {
  it('abierta y pendiente de respuesta conservan su estado', () => {
    expect(complementarAlerta('abierta', 'Se adjunta detalle')).toEqual({
      ok: true,
      valor: 'abierta',
    });
    expect(complementarAlerta('pendiente_respuesta', 'Detalle')).toEqual({
      ok: true,
      valor: 'pendiente_respuesta',
    });
  });

  it('una cerrada no se complementa y el texto es obligatorio', () => {
    expect(complementarAlerta('cerrada', 'Tarde')).toEqual({
      ok: false,
      motivo: 'TRANSICION_INVALIDA',
    });
    expect(complementarAlerta('abierta', '   ')).toEqual({
      ok: false,
      motivo: 'TEXTO_OBLIGATORIO',
    });
  });
});
