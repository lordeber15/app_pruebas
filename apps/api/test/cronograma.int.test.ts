import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  conToken,
  enCampo,
  iniciarEntorno,
  organizacion,
  pedir,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

/**
 * Cronograma base y vigente (RF-W12, RN-35, RN-36, E-08). Escenario sintético: una campaña con su
 * cronograma base (A01) de dos filas para la brigada A —la estación del escenario el 2 de
 * diciembre y un traslado el 3— y la reserva estación × método apuntando a la fila de la estación.
 */
let e: Entorno;
let o: Organizacion;
let campaniaId: string;
let baseId: string;
let itemEstacion: string;
let itemTraslado: string;

interface Cronograma {
  versiones: { id: string; numero: number; estado: string; es_base: boolean }[];
  version: { id: string; numero: number; estado: string } | null;
  items: {
    id: string;
    linaje_id: string;
    brigada_id: string;
    fecha: string;
    tipo_actividad: string;
    estacion_id: string | null;
    estacion_codigo: string | null;
    estado_fila: string;
    base_fecha: string | null;
    base_brigada_id: string | null;
    agregada: boolean;
  }[];
}

interface Solicitud {
  id: string;
  estado: string;
  version_base_numero: number;
  version_resultante_numero: number | null;
  impacto: {
    estaciones_afectadas: string[];
    estaciones_afectadas_codigos: string[];
    fechas_afectadas: string[];
    items_desaparecidos: string[];
  } | null;
}

const cronograma = async (token: string, version?: number) => {
  const r = await pedir(
    e,
    token,
    'GET',
    `/proyectos/${o.esc.proyectoId}/cronograma${version === undefined ? '' : `?version=${String(version)}`}`,
  );
  return { status: r.statusCode, cuerpo: r.json<Cronograma>() };
};

const proponer = (token: string, cuerpo: object) =>
  pedir(e, token, 'POST', `/proyectos/${o.esc.proyectoId}/cronograma/solicitudes`, cuerpo);

const reprogramarEstacion = (
  fecha: string,
  brigada: string | null = null,
  itemId = itemEstacion,
) => ({
  motivo: 'Lluvia intensa: el acceso a la estación está cerrado.',
  cambios: [{ tipo: 'reprogramar', item_id: itemId, fecha, brigada_id: brigada }],
});

/** Id en la versión vigente de la fila con ese linaje (cada versión tiene ids propios). */
const idVigente = async (linaje: string): Promise<string> =>
  (await cronograma(o.coordinacion.token)).cuerpo.items.find((i) => i.linaje_id === linaje)?.id ??
  '';

const solicitudes = async (token: string) =>
  (await pedir(e, token, 'GET', `/proyectos/${o.esc.proyectoId}/cronograma/solicitudes`)).json<{
    solicitudes: Solicitud[];
  }>().solicitudes;

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  campaniaId = generarId();
  baseId = generarId();
  itemEstacion = generarId();
  itemTraslado = generarId();
  await e.admin
    .insertInto('campania')
    .values({ id: campaniaId, proyecto_id: o.esc.proyectoId, nombre: 'Campaña sintética' })
    .execute();
  await e.admin
    .insertInto('cronograma_version')
    .values({ id: baseId, campania_id: campaniaId, numero: 1, estado: 'vigente', es_base: true })
    .execute();
  // Sin linaje: lo completa el trigger (la carga de A01 no lo conoce).
  await sql`
    INSERT INTO app.cronograma_item (id, version_id, brigada_id, fecha, tipo_actividad, estacion_id, orden)
    VALUES (${itemEstacion}, ${baseId}, ${o.esc.brigadaId}, '2026-12-02', 'estacion', ${o.esc.estacionId}, 1),
           (${itemTraslado}, ${baseId}, ${o.esc.brigadaId}, '2026-12-03', 'traslado', NULL, 2)`.execute(
    e.admin,
  );
  await e.admin
    .updateTable('reserva')
    .set({ cronograma_item_id: itemEstacion, fecha_programada: '2026-12-02' })
    .where('id', '=', o.esc.reservaId)
    .execute();
});
afterAll(async () => {
  await e.cerrar();
});

describe('cronograma base y vigente (RF-W12)', () => {
  it('Coordinación ve el base como versión vigente con el código de cada estación', async () => {
    const r = await cronograma(o.coordinacion.token);
    expect(r.status).toBe(200);
    expect(r.cuerpo.version).toMatchObject({ numero: 1, estado: 'vigente' });
    expect(r.cuerpo.items).toHaveLength(2);
    const est = r.cuerpo.items.find((i) => i.id === itemEstacion);
    expect(est).toMatchObject({
      linaje_id: itemEstacion,
      fecha: '2026-12-02',
      estado_fila: 'ok',
      base_fecha: '2026-12-02',
      agregada: false,
    });
    expect(est?.estacion_codigo).toMatch(/^EST-/);
  });

  it('alcance: los miembros de la brigada ven la suya; los de otra, nada; Admin y otro proyecto, 404', async () => {
    expect((await cronograma(o.especialista.token)).cuerpo.items).toHaveLength(2);
    expect((await cronograma(o.jefeA.token)).cuerpo.items).toHaveLength(2);
    const b = await cronograma(o.jefeB.token);
    expect(b.status).toBe(200);
    expect(b.cuerpo.items).toHaveLength(0);
    expect((await cronograma(o.admin.token)).status).toBe(404);

    const otra = await organizacion(e);
    expect((await cronograma(otra.especialista.token)).status).toBe(404);
    const ajena = await pedir(
      e,
      o.especialista.token,
      'GET',
      `/proyectos/${otra.esc.proyectoId}/cronograma`,
    );
    expect(ajena.statusCode).toBe(404);
    expect((await cronograma(o.coordinacion.token, 9)).status).toBe(404);
  });
});

describe('RN-36 propuestas de reprogramación', () => {
  it('RN-36: especialista, supervisor, Jefe de Brigada y Admin no proponen (403)', async () => {
    for (const p of [o.especialista, o.supervisorA, o.jefeA, o.admin]) {
      expect((await proponer(p.token, reprogramarEstacion('2026-12-05'))).statusCode).toBe(403);
    }
  });

  it('RN-35: cambios inválidos se rechazan (fila inexistente, brigada o estación de otro proyecto)', async () => {
    const otra = await organizacion(e);
    const fila = await proponer(o.coordinacion.token, {
      motivo: 'x',
      cambios: [
        { tipo: 'reprogramar', item_id: generarId(), fecha: '2026-12-05', brigada_id: null },
      ],
    });
    expect(fila.statusCode).toBe(400);
    expect(fila.json()).toMatchObject({ codigo: 'CAMBIO_INVALIDO' });
    const brigada = await proponer(
      o.coordinacion.token,
      reprogramarEstacion('2026-12-05', otra.esc.brigadaId),
    );
    expect(brigada.json()).toMatchObject({ codigo: 'CAMBIO_INVALIDO' });
    const estacion = await proponer(o.coordinacion.token, {
      motivo: 'Estación nueva',
      cambios: [
        {
          tipo: 'agregar',
          item: {
            id: generarId(),
            brigada_id: o.esc.brigadaId,
            fecha: '2026-12-09',
            tipo_actividad: 'estacion',
            estacion_id: otra.esc.estacionId,
            detalle: null,
            actividad_especial: null,
          },
        },
      ],
    });
    expect(estacion.json()).toMatchObject({ codigo: 'CAMBIO_INVALIDO' });
    // Sin «eliminar»: el esquema de core no tiene ese cambio (RN-35).
    const eliminar = await proponer(o.coordinacion.token, {
      motivo: 'x',
      cambios: [{ tipo: 'eliminar', item_id: itemEstacion }],
    });
    expect(eliminar.statusCode).toBe(400);
    // Otro proyecto que no existe.
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${generarId()}/cronograma/solicitudes`,
      reprogramarEstacion('2026-12-05'),
    );
    expect(r.statusCode).toBe(404);
  });

  it('las propuestas solo las listan Coordinación y JdP', async () => {
    expect(
      (
        await pedir(
          e,
          o.especialista.token,
          'GET',
          `/proyectos/${o.esc.proyectoId}/cronograma/solicitudes`,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await pedir(
          e,
          o.jefeA.token,
          'GET',
          `/proyectos/${o.esc.proyectoId}/cronograma/solicitudes`,
        )
      ).statusCode,
    ).toBe(403);
  });
});

describe('E-08 reprogramación aprobada por el Jefe de Proyecto', () => {
  let s1: string;
  let s2: string;

  it('CA-E08: Coordinación propone y el sistema muestra estaciones y fechas afectadas', async () => {
    const r = await proponer(
      o.coordinacion.token,
      reprogramarEstacion('2026-12-06', o.esc.brigadaB),
    );
    expect(r.statusCode).toBe(201);
    s1 = r.json<{ id: string }>().id;
    // Una segunda propuesta sobre la misma versión base: se aprobará después (linaje).
    const r2 = await proponer(o.coordinacion.token, {
      motivo: 'Feriado local: el traslado pasa a la espera de decisión.',
      cambios: [{ tipo: 'marcar', item_id: itemTraslado, estado_fila: 'sujeta_a_decision' }],
    });
    expect(r2.statusCode).toBe(201);
    s2 = r2.json<{ id: string }>().id;

    const lista = await solicitudes(o.jefeProyecto.token);
    const una = lista.find((s) => s.id === s1);
    expect(una).toMatchObject({ estado: 'pendiente', version_base_numero: 1 });
    expect(una?.impacto?.estaciones_afectadas).toEqual([o.esc.estacionId]);
    expect(una?.impacto?.estaciones_afectadas_codigos[0]).toMatch(/^EST-/);
    expect(una?.impacto?.fechas_afectadas).toEqual(['2026-12-02', '2026-12-06']);
    expect(una?.impacto?.items_desaparecidos).toEqual([]);
  });

  it('RN-36: Coordinación no aprueba ni rechaza; tampoco el especialista (403)', async () => {
    for (const p of [o.coordinacion, o.especialista, o.supervisorA, o.jefeA]) {
      expect(
        (await pedir(e, p.token, 'POST', `/cronograma/solicitudes/${s1}/aprobar`)).statusCode,
      ).toBe(403);
      expect(
        (
          await pedir(e, p.token, 'POST', `/cronograma/solicitudes/${s1}/rechazar`, {
            comentario: 'No',
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await pedir(
          e,
          o.jefeProyecto.token,
          'POST',
          `/cronograma/solicitudes/${generarId()}/aprobar`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('RN-35 E-08: al aprobar, el base se conserva y la versión 2 queda vigente con la estación reprogramada', async () => {
    const r = await pedir(e, o.jefeProyecto.token, 'POST', `/cronograma/solicitudes/${s1}/aprobar`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ numero: 2, reservas_reubicadas: 1 });

    const vigente = await cronograma(o.coordinacion.token);
    expect(vigente.cuerpo.version).toMatchObject({ numero: 2, estado: 'vigente' });
    expect(vigente.cuerpo.versiones.map((v) => [v.numero, v.estado])).toEqual([
      [1, 'historica'],
      [2, 'vigente'],
    ]);
    // Ninguna fila desaparece: la estación sigue, reprogramada, con su fecha base a la vista.
    expect(vigente.cuerpo.items).toHaveLength(2);
    const est = vigente.cuerpo.items.find((i) => i.linaje_id === itemEstacion);
    expect(est).toMatchObject({
      fecha: '2026-12-06',
      brigada_id: o.esc.brigadaB,
      estado_fila: 'reprogramada',
      base_fecha: '2026-12-02',
      base_brigada_id: o.esc.brigadaId,
    });
    expect(est?.id).not.toBe(itemEstacion);

    // El base, intacto.
    const base = await cronograma(o.coordinacion.token, 1);
    expect(base.cuerpo.items.find((i) => i.id === itemEstacion)).toMatchObject({
      fecha: '2026-12-02',
      brigada_id: o.esc.brigadaId,
      estado_fila: 'ok',
    });

    // La reserva sigue a su fila: brigada B y la fecha nueva.
    const reserva = await e.admin
      .selectFrom('reserva')
      .select([
        'brigada_id',
        'cronograma_item_id',
        sql<string>`to_char(fecha_programada, 'YYYY-MM-DD')`.as('fecha'),
      ])
      .where('id', '=', o.esc.reservaId)
      .executeTakeFirstOrThrow();
    expect(reserva).toEqual({
      brigada_id: o.esc.brigadaB,
      cronograma_item_id: est?.id,
      fecha: '2026-12-06',
    });

    const aprobada = (await solicitudes(o.jefeProyecto.token)).find((s) => s.id === s1);
    expect(aprobada).toMatchObject({ estado: 'aprobada', version_resultante_numero: 2 });
  });

  it('CA-E08: el celular de la brigada B recibe la versión vigente y la reserva al descargar el paquete', async () => {
    const enB = await enCampo(e, o.esc.brigadaB);
    const r = await e.app.inject({
      method: 'GET',
      url: '/api/v1/paquete/campo',
      headers: conToken(enB.token),
    });
    expect(r.statusCode).toBe(200);
    const p = r.json<{
      cronograma: { estacion_id: string | null; fecha: string; version: number }[];
      reservas: { id: string; fecha_programada: string | null }[];
    }>();
    expect(p.cronograma).toEqual([
      expect.objectContaining({ estacion_id: o.esc.estacionId, fecha: '2026-12-06', version: 2 }),
    ]);
    expect(p.reservas).toEqual([
      expect.objectContaining({ id: o.esc.reservaId, fecha_programada: '2026-12-06' }),
    ]);

    const enA = await enCampo(e, o.esc.brigadaId);
    const a = (
      await e.app.inject({
        method: 'GET',
        url: '/api/v1/paquete/campo',
        headers: conToken(enA.token),
      })
    ).json<{ cronograma: { version: number }[]; reservas: unknown[] }>();
    expect(a.reservas).toEqual([]);
    expect(a.cronograma.every((i) => i.version === 2)).toBe(true);
  });

  it('una solicitud aprobada no se vuelve a decidir (máquina de estados)', async () => {
    const r = await pedir(e, o.jefeProyecto.token, 'POST', `/cronograma/solicitudes/${s1}/aprobar`);
    expect(r.statusCode).toBe(409);
    const rechazo = await pedir(
      e,
      o.jefeProyecto.token,
      'POST',
      `/cronograma/solicitudes/${s1}/rechazar`,
      {
        comentario: 'Tarde',
      },
    );
    expect(rechazo.statusCode).toBe(409);
  });

  it('RN-36: pedir ajuste exige comentario; Coordinación ajusta y el JdP aprueba sobre la versión vigente', async () => {
    const sinComentario = await pedir(
      e,
      o.jefeProyecto.token,
      'POST',
      `/cronograma/solicitudes/${s2}/pedir-ajuste`,
      {
        comentario: ' ',
      },
    );
    expect(sinComentario.statusCode).toBe(400);
    const ajuste = await pedir(
      e,
      o.jefeProyecto.token,
      'POST',
      `/cronograma/solicitudes/${s2}/pedir-ajuste`,
      {
        comentario: 'Indique también la fecha probable.',
      },
    );
    expect(ajuste.statusCode).toBe(204);
    // Coordinación no puede aprobar su propia propuesta ajustada; el especialista no ajusta.
    expect(
      (
        await pedir(e, o.especialista.token, 'POST', `/cronograma/solicitudes/${s2}/ajustar`, {
          cambios: [{ tipo: 'marcar', item_id: itemTraslado, estado_fila: 'sujeta_a_decision' }],
        })
      ).statusCode,
    ).toBe(403);

    // La propuesta se reformula sobre la versión 2 (la fila del traslado tiene otro id ahí).
    const v2 = await cronograma(o.coordinacion.token);
    const traslado = v2.cuerpo.items.find((i) => i.linaje_id === itemTraslado);
    const ajustada = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/cronograma/solicitudes/${s2}/ajustar`,
      {
        motivo: 'Feriado local: traslado sujeto a decisión, probable 4 de diciembre.',
        cambios: [{ tipo: 'marcar', item_id: traslado?.id, estado_fila: 'sujeta_a_decision' }],
      },
    );
    expect(ajustada.statusCode).toBe(204);
    expect((await solicitudes(o.jefeProyecto.token)).find((s) => s.id === s2)).toMatchObject({
      estado: 'pendiente',
      version_base_numero: 2,
    });
    const r = await pedir(e, o.jefeProyecto.token, 'POST', `/cronograma/solicitudes/${s2}/aprobar`);
    expect(r.statusCode).toBe(200);
    const v3 = await cronograma(o.coordinacion.token);
    expect(v3.cuerpo.version?.numero).toBe(3);
    expect(v3.cuerpo.items.map((i) => [i.linaje_id, i.estado_fila]).sort()).toEqual(
      [
        [itemEstacion, 'reprogramada'],
        [itemTraslado, 'sujeta_a_decision'],
      ].sort(),
    );
  });

  it('RN-35: una propuesta hecha sobre una versión anterior se traslada por linaje a la vigente', async () => {
    const vieja = await proponer(
      o.coordinacion.token,
      reprogramarEstacion('2026-12-08', null, await idVigente(itemEstacion)),
    );
    expect(vieja.statusCode).toBe(201);
    const id = vieja.json<{ id: string }>().id;
    // Mientras tanto, se propone y aprueba otra sobre la vigente (versión 3 → 4).
    const v3 = await cronograma(o.coordinacion.token);
    const traslado = v3.cuerpo.items.find((i) => i.linaje_id === itemTraslado);
    const otra = await proponer(o.coordinacion.token, {
      motivo: 'Se confirma el traslado.',
      cambios: [
        { tipo: 'reprogramar', item_id: traslado?.id, fecha: '2026-12-04', brigada_id: null },
      ],
    });
    await pedir(
      e,
      o.jefeProyecto.token,
      'POST',
      `/cronograma/solicitudes/${otra.json<{ id: string }>().id}/aprobar`,
    );
    // La primera (hecha sobre la versión 3) se aprueba sobre la 4.
    const r = await pedir(e, o.jefeProyecto.token, 'POST', `/cronograma/solicitudes/${id}/aprobar`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ numero: 5 });
    const v5 = await cronograma(o.coordinacion.token);
    expect(v5.cuerpo.items.find((i) => i.linaje_id === itemEstacion)).toMatchObject({
      fecha: '2026-12-08',
      brigada_id: o.esc.brigadaB,
    });
    expect(v5.cuerpo.items.find((i) => i.linaje_id === itemTraslado)).toMatchObject({
      fecha: '2026-12-04',
      estado_fila: 'reprogramada',
    });
  });

  it('el JdP rechaza con comentario y nada cambia', async () => {
    const r = await proponer(
      o.coordinacion.token,
      reprogramarEstacion('2026-12-20', null, await idVigente(itemEstacion)),
    );
    const id = r.json<{ id: string }>().id;
    const antes = (await cronograma(o.coordinacion.token)).cuerpo.version?.numero;
    const rechazo = await pedir(
      e,
      o.jefeProyecto.token,
      'POST',
      `/cronograma/solicitudes/${id}/rechazar`,
      {
        comentario: 'La brigada B no tiene disponibilidad.',
      },
    );
    expect(rechazo.statusCode).toBe(204);
    expect((await cronograma(o.coordinacion.token)).cuerpo.version?.numero).toBe(antes);
    expect((await solicitudes(o.coordinacion.token)).find((s) => s.id === id)?.estado).toBe(
      'rechazada',
    );
  });
});

describe('RN-35 inmutabilidad en la base de datos', () => {
  it('RN-35: la API (app_rw) no puede modificar filas del cronograma ni datos de una versión', async () => {
    await expect(
      e.db
        .updateTable('cronograma_item')
        .set({ fecha: '2027-01-01' })
        .where('id', '=', itemEstacion)
        .execute(),
    ).rejects.toThrow(/permission denied/);
    await expect(
      e.db.updateTable('cronograma_version').set({ numero: 99 }).where('id', '=', baseId).execute(),
    ).rejects.toThrow(/RN-35/);
    await expect(
      e.db
        .updateTable('cronograma_version')
        .set({ estado: 'vigente' })
        .where('id', '=', baseId)
        .execute(),
    ).rejects.toThrow(/RN-35/);
  });
});
