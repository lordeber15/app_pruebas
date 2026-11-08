import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  conToken,
  enCampo,
  enviarLote,
  foto,
  HORA,
  iniciarEntorno,
  lote,
  nuevoEscenario,
  sobre,
  type Entorno,
  type Escenario,
} from './entorno.ts';

/**
 * Comportamiento general de la sincronización (doc. 03 §9): idempotencia, orden, identidad,
 * eventos inválidos o del modelo anterior, jornada y bajada incremental. El ciclo completo de una
 * ejecución TOCE se prueba en `campo.int.test.ts`.
 */
let e: Entorno;
let esc: Escenario;

beforeAll(async () => {
  e = await iniciarEntorno();
  esc = await nuevoEscenario(e);
});
afterAll(async () => {
  await e.cerrar();
});

const UBICACION = { lat: -10.1, lon: -75.2, precision_m: 6 };

describe('sincronización de eventos', () => {
  it('CP-026 RN-10 reenviar el mismo lote no duplica nada', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const ejecucionId = generarId();
    const eventos = [abrir(ejecucionId, esc), foto(ejecucionId, null)];
    expect((await lote(e, yo.token, eventos)).map((x) => x.estado)).toEqual([
      'aplicado',
      'aplicado',
    ]);
    expect((await lote(e, yo.token, eventos)).map((x) => x.estado)).toEqual([
      'ya_aplicado',
      'ya_aplicado',
    ]);
    const filas = await e.admin
      .selectFrom('evento')
      .select('id')
      .where(
        'id',
        'in',
        eventos.map((x) => x.id),
      )
      .execute();
    expect(filas).toHaveLength(2);
  });

  it('RN-12 al reenviar un evento no aplicado se repite su motivo', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const ev = foto(generarId(), null);
    await lote(e, yo.token, [ev]);
    expect((await lote(e, yo.token, [ev]))[0]).toMatchObject({
      estado: 'no_aplicado',
      motivo: 'EJECUCION_AJENA',
    });
  });

  it('CP-039 RN-12 SEG-01 un evento sobre la ejecución de otro usuario queda no aplicado y se guarda', async () => {
    const duena = await enCampo(e, esc.brigadaId);
    const ejecucionId = generarId();
    await lote(e, duena.token, [abrir(ejecucionId, esc)]);
    const intruso = await enCampo(e, esc.brigadaId);
    const [r] = await lote(e, intruso.token, [foto(ejecucionId, null)]);
    expect(r).toMatchObject({ estado: 'no_aplicado', motivo: 'EJECUCION_AJENA' });
    const guardado = await e.admin
      .selectFrom('evento')
      .select(['usuario_id', 'estado'])
      .where('id', '=', r?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(guardado).toEqual({ usuario_id: intruso.usuario.id, estado: 'no_aplicado' });
  });

  it('usuario_id y dispositivo_id del cuerpo deben coincidir con la sesión', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const ev = { ...abrir(generarId(), esc), usuario_id: generarId() };
    expect((await lote(e, yo.token, [ev]))[0]).toMatchObject({
      estado: 'no_aplicado',
      motivo: 'IDENTIDAD_NO_COINCIDE',
    });
    const fila = await e.admin
      .selectFrom('evento')
      .select('usuario_id')
      .where('id', '=', ev.id)
      .executeTakeFirstOrThrow();
    expect(fila.usuario_id).toBe(yo.usuario.id);
  });

  it('el Jefe de Brigada no ejecuta métodos (ERS §2.3)', async () => {
    const jefe = await enCampo(e, esc.brigadaId, 'jefe_brigada');
    expect((await lote(e, jefe.token, [abrir(generarId(), esc)]))[0]).toMatchObject({
      estado: 'no_aplicado',
      motivo: 'FUERA_DE_ALCANCE',
    });
  });

  it('el Supervisor de campo ejecuta métodos como especialista (ERS §2.2)', async () => {
    const sup = await enCampo(e, esc.brigadaId, 'supervisor_campo');
    expect((await lote(e, sup.token, [abrir(generarId(), esc)]))[0]?.estado).toBe('aplicado');
  });

  it('un evento con formato inválido se guarda como no aplicado sin trabar el lote', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const ejecucionId = generarId();
    const roto = { ...abrir(generarId(), esc), payload: { ejecucion_id: 'x' } };
    const r = await lote(e, yo.token, [roto, abrir(ejecucionId, esc)]);
    expect(r.map((x) => [x.estado, x.motivo])).toEqual([
      ['no_aplicado', 'ESQUEMA_INVALIDO'],
      ['aplicado', undefined],
    ]);
  });

  it('RN-12 un evento del modelo anterior (tarea) se guarda completo como esquema inválido', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const viejo = {
      ...sobre('tarea_completada', { tipo: 'tarea', id: generarId() }, { archivo_ids: [] }),
      asignacion_id: generarId(),
    };
    expect((await lote(e, yo.token, [viejo]))[0]).toMatchObject({
      estado: 'no_aplicado',
      motivo: 'ESQUEMA_INVALIDO',
    });
    const fila = await e.admin
      .selectFrom('evento')
      .select(['tipo', 'payload'])
      .where('id', '=', viejo.id)
      .executeTakeFirstOrThrow();
    expect(fila.tipo).toBe('tarea_completada');
    expect(fila.payload).toMatchObject({ tipo: 'tarea_completada' });
  });

  it('un lote con un id que no es UUID v7 se rechaza completo', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const r = await enviarLote(e, yo.token, [{ id: '3b241101-e2bb-4255-8caf-4136c566a962' }]);
    expect(r.statusCode).toBe(400);
  });

  it('los eventos aún no implementados se conservan completos', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const ev = sobre(
      'articulo_marcado',
      { tipo: 'articulo', id: generarId() },
      { articulo_id: generarId(), marcado: true },
    );
    expect((await lote(e, yo.token, [ev]))[0]).toMatchObject({
      estado: 'no_aplicado',
      motivo: 'NO_IMPLEMENTADO',
    });
    const fila = await e.admin
      .selectFrom('evento')
      .select('payload')
      .where('id', '=', ev.id)
      .executeTakeFirstOrThrow();
    expect(fila.payload).toEqual(ev.payload);
  });

  it('RN-09 la hora del servidor la asigna la API; la del dispositivo se guarda como dato', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const antes = Date.now();
    const ev = abrir(generarId(), esc);
    await lote(e, yo.token, [ev]);
    const fila = await e.admin
      .selectFrom('evento')
      .select(['hora_servidor', 'hora_dispositivo', 'ubicacion'])
      .where('id', '=', ev.id)
      .executeTakeFirstOrThrow();
    expect(fila.hora_servidor.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(fila.hora_dispositivo?.toISOString()).toBe(new Date(HORA).toISOString());
    expect(fila.ubicacion).toEqual(UBICACION);
  });
});

describe('jornada', () => {
  it('RN-23 abre y cierra la jornada; cerrar dos veces no la cambia', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const jornada = { tipo: 'jornada', id: generarId() };
    const abre = {
      ...sobre('jornada_iniciada', jornada, {}),
      hora_dispositivo: '2026-11-10T06:00:00-05:00',
    };
    const cierra = {
      ...sobre('jornada_cerrada', jornada, { automatica: true }),
      hora_dispositivo: '2026-11-10T18:00:00-05:00',
    };
    const r = await lote(e, yo.token, [abre, cierra, { ...cierra, id: generarId() }]);
    expect(r.map((x) => x.estado)).toEqual(['aplicado', 'aplicado', 'ya_aplicado']);
    const j = await e.admin
      .selectFrom('jornada')
      .select(['cierre_automatico', 'cerrada_en'])
      .where('id', '=', jornada.id)
      .executeTakeFirstOrThrow();
    expect(j).toEqual({ cierre_automatico: true, cerrada_en: new Date('2026-11-10T23:00:00Z') });
  });
});

describe('bajada incremental (doc. 03 §9.4)', () => {
  const cambios = (token: string, desde?: string) =>
    e.app.inject({
      method: 'GET',
      url: `/api/v1/sync/cambios${desde === undefined ? '' : `?desde=${encodeURIComponent(desde)}`}`,
      headers: conToken(token),
    });

  type Cambios = {
    cambios: { entidad: string; id: string; operacion: string; datos: Record<string, unknown> }[];
    cursor: string;
  };

  /** Foto propia anunciada en una ejecución nueva; devuelve su id. */
  const fotoPropia = async (token: string) => {
    const ejecucionId = generarId();
    const f = foto(ejecucionId, null);
    await lote(e, token, [abrir(ejecucionId, esc), f]);
    return f.payload.archivo_id;
  };

  it('RF-M17 CP-041 la orden de baja llega en la bajada', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    await e.admin
      .updateTable('dispositivo')
      .set({ estado: 'baja_pendiente' })
      .where('id', '=', yo.dispositivoId)
      .execute();
    expect((await cambios(yo.token)).json<Cambios>().cambios).toContainEqual({
      entidad: 'dispositivo',
      id: yo.dispositivoId,
      operacion: 'baja',
      datos: {},
    });
  });

  it('solo llegan archivos propios y la orden de baja; nada del modelo anterior', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const propio = await fotoPropia(yo.token);
    const otro = await enCampo(e, esc.brigadaId);
    const ajeno = await fotoPropia(otro.token);
    const r = (await cambios(yo.token)).json<Cambios>();
    const ids = r.cambios.map((c) => c.id);
    expect(ids).toContain(propio);
    expect(ids).not.toContain(ajeno);
    expect(new Set(r.cambios.map((c) => c.entidad))).toEqual(new Set(['archivo']));
  });

  it('con el cursor solo llegan los cambios posteriores (salvo el margen de seguridad)', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    const primera = await fotoPropia(yo.token);
    const { cursor } = (await cambios(yo.token)).json<Cambios>();
    // Se lleva el primer archivo fuera del margen de 30 s (sin el trigger que renueva la fecha).
    await sql`ALTER TABLE app.archivo DISABLE TRIGGER archivo_actualizado_en`.execute(e.admin);
    try {
      await e.admin
        .updateTable('archivo')
        .set({ actualizado_en: new Date(Date.now() - 120_000) })
        .where('id', '=', primera)
        .execute();
    } finally {
      await sql`ALTER TABLE app.archivo ENABLE TRIGGER archivo_actualizado_en`.execute(e.admin);
    }
    const segunda = await fotoPropia(yo.token);
    const ids = (await cambios(yo.token, cursor)).json<Cambios>().cambios.map((c) => c.id);
    expect(ids).toContain(segunda);
    expect(ids).not.toContain(primera);
  });

  it('un cursor inválido responde 400', async () => {
    const yo = await enCampo(e, esc.brigadaId);
    expect((await cambios(yo.token, 'no-es-un-cursor')).statusCode).toBe(400);
  });
});
