import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  enCampo,
  iniciarEntorno,
  lote,
  organizacion,
  pedir,
  sobre,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

let e: Entorno;
let o: Organizacion;
/** Otro proyecto, para las pruebas negativas de alcance. */
let otro: Organizacion;

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  otro = await organizacion(e);
});
afterAll(async () => {
  await e.cerrar();
});

interface Datos {
  readonly brigada_id: string;
  readonly tipo?: 'tecnica' | 'logistica';
  readonly categoria?: string | null;
  readonly titulo?: string;
  readonly estacion_id?: string | null;
  readonly ejecucion_id?: string | null;
  readonly reserva_id?: string | null;
  readonly afecta_cronograma?: boolean;
}

const alertaCampo = (d: Datos, alertaId: string = generarId()) =>
  sobre(
    'alerta_local_generada',
    { tipo: 'alerta', id: alertaId },
    {
      alerta_id: alertaId,
      brigada_id: d.brigada_id,
      tipo: d.tipo ?? 'tecnica',
      categoria: d.categoria ?? null,
      titulo: d.titulo ?? 'Trampa 4 inundada',
      descripcion: 'Se reubicó a 20 m',
      estacion_id: d.estacion_id ?? null,
      ejecucion_id: d.ejecucion_id ?? null,
      reserva_id: d.reserva_id ?? null,
      afecta_cronograma: d.afecta_cronograma ?? false,
    },
  );

/** Alerta técnica de un especialista de campo de la brigada A, ya sincronizada. */
const alertaSincronizada = async () => {
  const yo = await enCampo(e, o.esc.brigadaId);
  const ev = alertaCampo({ brigada_id: o.esc.brigadaId, estacion_id: o.esc.estacionId });
  const [r] = await lote(e, yo.token, [ev]);
  expect(r).toMatchObject({ estado: 'aplicado' });
  return { yo, alertaId: ev.payload.alerta_id };
};

const ids = (r: { json: () => unknown }) =>
  (r.json() as { alertas: { id: string }[] }).alertas.map((a) => a.id);

describe('RN-36 alertas registradas en campo (D02 §13)', () => {
  it('especialista registra una técnica: llega abierta con usuario y dispositivo de la sesión', async () => {
    const yo = await enCampo(e, o.esc.brigadaId);
    const ev = alertaCampo({
      brigada_id: o.esc.brigadaId,
      reserva_id: o.esc.reservaId,
      afecta_cronograma: true,
    });
    const [r] = await lote(e, yo.token, [ev]);
    expect(r).toEqual({ id: ev.id, estado: 'aplicado' });
    const a = await e.admin
      .selectFrom('alerta')
      .selectAll()
      .where('id', '=', ev.payload.alerta_id)
      .executeTakeFirstOrThrow();
    expect(a).toMatchObject({
      tipo: 'tecnica',
      estado: 'abierta',
      origen: 'usuario',
      creado_por: yo.usuario.id,
      dispositivo_id: yo.dispositivoId,
      evento_id: ev.id,
      brigada_id: o.esc.brigadaId,
      // La estación sale de la reserva cuando el celular no la manda.
      estacion_id: o.esc.estacionId,
      afecta_cronograma: true,
      categoria: null,
    });
    expect(a.hora_dispositivo?.toISOString()).toBe(new Date(ev.hora_dispositivo).toISOString());
  });

  it('especialista no registra una logística (tiposDeAlerta)', async () => {
    const yo = await enCampo(e, o.esc.brigadaId);
    const ev = alertaCampo({
      brigada_id: o.esc.brigadaId,
      tipo: 'logistica',
      categoria: 'movilidad',
    });
    expect((await lote(e, yo.token, [ev]))[0]).toMatchObject({
      estado: 'no_aplicado',
      motivo: 'TIPO_NO_PERMITIDO',
    });
    const n = await e.admin
      .selectFrom('alerta')
      .select('id')
      .where('id', '=', ev.payload.alerta_id)
      .execute();
    expect(n).toHaveLength(0);
  });

  it('CA-E07 RN-20 el JdB registra la excepción logística con su categoría y no una técnica', async () => {
    const jdb = await enCampo(e, o.esc.brigadaId, 'jefe_brigada');
    const ev = alertaCampo({
      brigada_id: o.esc.brigadaId,
      tipo: 'logistica',
      categoria: 'muestras_equipos',
      titulo: 'Falta hielo para muestras',
    });
    const tecnica = alertaCampo({ brigada_id: o.esc.brigadaId });
    const r = await lote(e, jdb.token, [ev, tecnica]);
    expect(r[0]).toMatchObject({ estado: 'aplicado' });
    expect(r[1]).toMatchObject({ estado: 'no_aplicado', motivo: 'TIPO_NO_PERMITIDO' });
    const a = await e.admin
      .selectFrom('alerta')
      .select(['tipo', 'categoria'])
      .where('id', '=', ev.payload.alerta_id)
      .executeTakeFirstOrThrow();
    expect(a).toEqual({ tipo: 'logistica', categoria: 'muestras_equipos' });
    // Coordinación la ve en su bandeja.
    const bandeja = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/alertas?tipo=logistica`,
    );
    expect(ids(bandeja)).toContain(ev.payload.alerta_id);
  });

  it('supervisor de campo registra técnica', async () => {
    const sup = await enCampo(e, o.esc.brigadaId, 'supervisor_campo');
    expect(
      (await lote(e, sup.token, [alertaCampo({ brigada_id: o.esc.brigadaId })]))[0],
    ).toMatchObject({
      estado: 'aplicado',
    });
  });

  it('en otra brigada u otro proyecto: no aplicado', async () => {
    const yo = await enCampo(e, o.esc.brigadaId);
    const r = await lote(e, yo.token, [
      alertaCampo({ brigada_id: o.esc.brigadaB }),
      alertaCampo({ brigada_id: otro.esc.brigadaId }),
      // Estación de otro proyecto en la brigada propia.
      alertaCampo({ brigada_id: o.esc.brigadaId, estacion_id: otro.esc.estacionId }),
      // Reserva de otra brigada.
      alertaCampo({ brigada_id: o.esc.brigadaId, reserva_id: otro.esc.reservaId }),
    ]);
    expect(r.map((x) => x.motivo)).toEqual([
      'FUERA_DE_ALCANCE',
      'FUERA_DE_ALCANCE',
      'REFERENCIA_INVALIDA',
      'REFERENCIA_INVALIDA',
    ]);
  });

  it('RN-10 reenviar el lote no duplica la alerta', async () => {
    const yo = await enCampo(e, o.esc.brigadaId);
    const ev = alertaCampo({ brigada_id: o.esc.brigadaId });
    await lote(e, yo.token, [ev]);
    expect((await lote(e, yo.token, [ev]))[0]).toMatchObject({ estado: 'ya_aplicado' });
    // Otro evento con el mismo id de alerta tampoco la duplica.
    const otroEvento = { ...ev, id: generarId() };
    expect((await lote(e, yo.token, [otroEvento]))[0]).toMatchObject({ estado: 'ya_aplicado' });
    const filas = await e.admin
      .selectFrom('alerta')
      .select('id')
      .where('id', '=', ev.payload.alerta_id)
      .execute();
    expect(filas).toHaveLength(1);
  });

  it('el id de alerta de otro usuario no se reutiliza', async () => {
    const { alertaId } = await alertaSincronizada();
    const yo = await enCampo(e, o.esc.brigadaId);
    expect(
      (await lote(e, yo.token, [alertaCampo({ brigada_id: o.esc.brigadaId }, alertaId)]))[0],
    ).toMatchObject({ estado: 'no_aplicado', motivo: 'ENTIDAD_DUPLICADA' });
  });

  it('vinculada a la ejecución propia; si la ejecución aún no llegó, queda en revisión sin perderse', async () => {
    const yo = await enCampo(e, o.esc.brigadaId);
    const ejecucionId = generarId();
    const conEjecucion = alertaCampo({ brigada_id: o.esc.brigadaId, ejecucion_id: ejecucionId });
    const r = await lote(e, yo.token, [abrir(ejecucionId, o.esc), conEjecucion]);
    expect(r.map((x) => x.estado)).toEqual(['aplicado', 'aplicado']);
    const a = await e.admin
      .selectFrom('alerta')
      .select(['ejecucion_id', 'estacion_id'])
      .where('id', '=', conEjecucion.payload.alerta_id)
      .executeTakeFirstOrThrow();
    expect(a).toEqual({ ejecucion_id: ejecucionId, estacion_id: o.esc.estacionId });

    const tardia = alertaCampo({ brigada_id: o.esc.brigadaId, ejecucion_id: generarId() });
    expect((await lote(e, yo.token, [tardia]))[0]).toMatchObject({
      estado: 'en_revision',
      motivo: 'EJECUCION_PENDIENTE',
    });
    const b = await e.admin
      .selectFrom('alerta')
      .select('ejecucion_id')
      .where('id', '=', tardia.payload.alerta_id)
      .executeTakeFirstOrThrow();
    expect(b.ejecucion_id).toBeNull();
  });

  it('logística sin categoría: esquema inválido', async () => {
    const jdb = await enCampo(e, o.esc.brigadaId, 'jefe_brigada');
    expect(
      (
        await lote(e, jdb.token, [alertaCampo({ brigada_id: o.esc.brigadaId, tipo: 'logistica' })])
      )[0],
    ).toMatchObject({ estado: 'no_aplicado', motivo: 'ESQUEMA_INVALIDO' });
  });
});

describe('RF-W03 bandeja de alertas por alcance (D02 §9)', () => {
  it('Coordinación y JdP ven todas; la brigada la suya; la otra brigada no', async () => {
    const { alertaId } = await alertaSincronizada();
    const url = `/proyectos/${o.esc.proyectoId}/alertas`;
    for (const quien of [o.coordinacion, o.jefeProyecto, o.jefeA, o.supervisorA, o.especialista]) {
      const r = await pedir(e, quien.token, 'GET', url);
      expect(r.statusCode).toBe(200);
      expect(ids(r)).toContain(alertaId);
    }
    for (const quien of [o.jefeB, o.especialistaB]) {
      const r = await pedir(e, quien.token, 'GET', url);
      expect(r.statusCode).toBe(200);
      expect(ids(r)).not.toContain(alertaId);
    }
  });

  it('filtros por estado, tipo y brigada', async () => {
    const { alertaId } = await alertaSincronizada();
    const url = `/proyectos/${o.esc.proyectoId}/alertas`;
    const tok = o.coordinacion.token;
    expect(ids(await pedir(e, tok, 'GET', `${url}?estado=abierta&tipo=tecnica`))).toContain(
      alertaId,
    );
    expect(ids(await pedir(e, tok, 'GET', `${url}?estado=cerrada`))).not.toContain(alertaId);
    expect(ids(await pedir(e, tok, 'GET', `${url}?tipo=logistica`))).not.toContain(alertaId);
    expect(ids(await pedir(e, tok, 'GET', `${url}?brigada=${o.esc.brigadaB}`))).not.toContain(
      alertaId,
    );
    expect(ids(await pedir(e, tok, 'GET', `${url}?brigada=${o.esc.brigadaId}`))).toContain(
      alertaId,
    );
    expect((await pedir(e, tok, 'GET', `${url}?estado=pendiente_sync`)).statusCode).toBe(400);
  });

  it('muestra las post-sincronización generadas por el sistema', async () => {
    const id = generarId();
    await e.admin
      .insertInto('alerta')
      .values({
        id,
        proyecto_id: o.esc.proyectoId,
        tipo: 'post_sincronizacion',
        origen: 'sistema',
        brigada_id: o.esc.brigadaId,
        titulo: 'Faltan fotos obligatorias',
        clave_dedup: `regla:${id}`,
      })
      .execute();
    const r = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/alertas?tipo=post_sincronizacion`,
    );
    expect(ids(r)).toContain(id);
    expect(
      ids(await pedir(e, o.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}/alertas`)),
    ).toContain(id);
  });

  it('otro proyecto y el administrador técnico: no encontrado', async () => {
    const { alertaId } = await alertaSincronizada();
    expect(
      (await pedir(e, otro.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}/alertas`))
        .statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, o.admin.token, 'GET', `/proyectos/${o.esc.proyectoId}/alertas`)).statusCode,
    ).toBe(404);
    for (const quien of [otro.jefeA, otro.especialista, o.admin, o.jefeB, o.especialistaB]) {
      expect((await pedir(e, quien.token, 'GET', `/alertas/${alertaId}`)).statusCode).toBe(404);
    }
  });

  it('sin sesión: 401', async () => {
    const r = await e.app.inject({
      method: 'GET',
      url: `/api/v1/proyectos/${o.esc.proyectoId}/alertas`,
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('RN-36 respuestas, consultas, cierre y reapertura', () => {
  it('flujo completo con historial y autores', async () => {
    const { yo, alertaId } = await alertaSincronizada();
    const msj = (token: string, tipo: string, texto: string) =>
      pedir(e, token, 'POST', `/alertas/${alertaId}/mensajes`, { tipo, texto });

    // Coordinación pide respuesta → pendiente de respuesta.
    const c = await msj(o.coordinacion.token, 'consulta', '¿Se repuso la trampa?');
    expect(c.statusCode).toBe(201);
    expect(c.json()).toEqual({ estado: 'pendiente_respuesta' });
    // Consultar dos veces seguidas no es una transición válida.
    expect((await msj(o.coordinacion.token, 'consulta', 'otra')).statusCode).toBe(409);
    // El JdB complementa sin cambiar el estado; el especialista responde → abierta.
    expect((await msj(o.jefeA.token, 'complemento', 'Se envió repuesto')).json()).toEqual({
      estado: 'pendiente_respuesta',
    });
    expect((await msj(yo.token, 'respuesta', 'Sí, a 20 m')).json()).toEqual({ estado: 'abierta' });

    // El especialista no cierra; Coordinación sí.
    expect((await pedir(e, yo.token, 'POST', `/alertas/${alertaId}/cerrar`, {})).statusCode).toBe(
      403,
    );
    expect(
      (await pedir(e, o.jefeA.token, 'POST', `/alertas/${alertaId}/cerrar`, {})).statusCode,
    ).toBe(403);
    const cierre = await pedir(e, o.coordinacion.token, 'POST', `/alertas/${alertaId}/cerrar`, {
      comentario: 'Resuelto en campo',
    });
    expect(cierre.statusCode).toBe(200);
    expect(cierre.json()).toEqual({ estado: 'cerrada' });

    // Cerrada: no se responde ni se cierra otra vez.
    expect((await msj(yo.token, 'complemento', 'tarde')).statusCode).toBe(409);
    expect(
      (await pedir(e, o.jefeProyecto.token, 'POST', `/alertas/${alertaId}/cerrar`, {})).statusCode,
    ).toBe(409);

    // Reabrir: motivo obligatorio y solo quien cierra.
    expect(
      (await pedir(e, o.jefeProyecto.token, 'POST', `/alertas/${alertaId}/reabrir`, {})).statusCode,
    ).toBe(400);
    expect(
      (await pedir(e, yo.token, 'POST', `/alertas/${alertaId}/reabrir`, { motivo: 'x' }))
        .statusCode,
    ).toBe(403);
    const re = await pedir(e, o.jefeProyecto.token, 'POST', `/alertas/${alertaId}/reabrir`, {
      motivo: 'Nueva evidencia',
    });
    expect(re.json()).toEqual({ estado: 'abierta' });

    const d = await pedir(e, o.especialista.token, 'GET', `/alertas/${alertaId}`);
    expect(d.statusCode).toBe(200);
    const det = d.json<{
      estado: string;
      cerrado_en: string | null;
      estacion_codigo: string;
      mensajes: { tipo: string; texto: string; autor_nombre: string }[];
      permisos: Record<string, boolean>;
    }>();
    expect(det.estado).toBe('abierta');
    expect(det.cerrado_en).toBeNull();
    expect(det.mensajes.map((m) => m.tipo)).toEqual([
      'consulta',
      'complemento',
      'respuesta',
      'cierre',
      'reapertura',
    ]);
    expect(det.mensajes.every((m) => m.autor_nombre.length > 0)).toBe(true);
    expect(det.permisos).toEqual({
      puede_responder: true,
      puede_consultar: false,
      puede_cerrar: false,
      puede_reabrir: false,
    });
    const dc = await pedir(e, o.coordinacion.token, 'GET', `/alertas/${alertaId}`);
    expect(dc.json<{ permisos: Record<string, boolean> }>().permisos).toEqual({
      puede_responder: true,
      puede_consultar: true,
      puede_cerrar: true,
      puede_reabrir: false,
    });
  });

  it('el especialista no consulta; otra brigada, otro proyecto y admin no responden', async () => {
    const { alertaId } = await alertaSincronizada();
    const url = `/alertas/${alertaId}/mensajes`;
    expect(
      (await pedir(e, o.especialista.token, 'POST', url, { tipo: 'consulta', texto: 'x' }))
        .statusCode,
    ).toBe(403);
    for (const quien of [o.jefeB, o.especialistaB, otro.jefeA, o.admin]) {
      expect(
        (await pedir(e, quien.token, 'POST', url, { tipo: 'respuesta', texto: 'x' })).statusCode,
      ).toBe(404);
      expect(
        (await pedir(e, quien.token, 'POST', `/alertas/${alertaId}/cerrar`, {})).statusCode,
      ).toBe(404);
    }
    expect(
      (await pedir(e, o.jefeA.token, 'POST', url, { tipo: 'respuesta', texto: '  ' })).statusCode,
    ).toBe(400);
    expect(
      (await pedir(e, o.jefeA.token, 'POST', url, { tipo: 'cierre', texto: 'x' })).statusCode,
    ).toBe(400);
  });

  it('alerta inexistente: 404', async () => {
    expect(
      (await pedir(e, o.coordinacion.token, 'GET', `/alertas/${generarId()}`)).statusCode,
    ).toBe(404);
  });
});

describe('alertas registradas desde la web (Coordinación y JdP)', () => {
  it('Coordinación registra una logística con categoría; la brigada la ve', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${o.esc.proyectoId}/alertas`,
      {
        tipo: 'logistica',
        categoria: 'hospedaje',
        titulo: 'Sin hospedaje en el centro poblado',
        brigada_id: o.esc.brigadaId,
        estacion_id: o.esc.estacionId,
        afecta_cronograma: true,
      },
    );
    expect(r.statusCode).toBe(201);
    const { id } = r.json<{ id: string }>();
    expect(
      ids(await pedir(e, o.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}/alertas`)),
    ).toContain(id);
    const a = await e.admin
      .selectFrom('alerta')
      .select(['origen', 'dispositivo_id', 'estado'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(a).toEqual({ origen: 'usuario', dispositivo_id: null, estado: 'abierta' });
  });

  it('roles de campo y admin no registran desde la web; brigada de otro proyecto no vale', async () => {
    const url = `/proyectos/${o.esc.proyectoId}/alertas`;
    const cuerpo = { tipo: 'tecnica', titulo: 'x' };
    for (const quien of [o.especialista, o.jefeA, o.admin]) {
      expect((await pedir(e, quien.token, 'POST', url, cuerpo)).statusCode).toBe(403);
    }
    expect(
      (
        await pedir(e, o.coordinacion.token, 'POST', url, {
          ...cuerpo,
          brigada_id: otro.esc.brigadaId,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, o.coordinacion.token, 'POST', url, { tipo: 'logistica', titulo: 'x' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await pedir(e, o.coordinacion.token, 'POST', url, {
          tipo: 'post_sincronizacion',
          titulo: 'x',
        })
      ).statusCode,
    ).toBe(400);
  });
});
