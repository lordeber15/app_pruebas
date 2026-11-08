import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  conToken,
  iniciarEntorno,
  lote,
  organizacion,
  pedir,
  persona,
  usuarioConDispositivo,
  type Entorno,
  type Organizacion,
  type Persona,
} from './entorno.ts';

/**
 * Panel «Métodos a ejecutar» por estación (decisión del usuario 2026-11-08; RN-28, P-01):
 * Coordinación y JdP confirman o descartan los CONDICIONAL de una estación con motivo. Confirmar
 * crea (una sola vez) la reserva; descartar no la borra, la marca `descartada` y deja de ir al
 * celular. La decisión es nominal: la rederivación por atributos no la pisa.
 */
let e: Entorno;
let o: Organizacion;
let proyectoId: string;
let brigadaA: string;
let estacionId: string;
let campo: Awaited<ReturnType<typeof usuarioConDispositivo>>;
let jefeBrigada: Persona;
const metodo: Record<string, string> = {};

interface MetodoPanel {
  metodo_id: string;
  codigo: string;
  clase: string;
  estado: string;
  origen: string | null;
  condicion_d01: string;
  resumen_d01: { clave: string; valor: string; tipo_control: string | null }[] | null;
  reserva: { id: string; estado: string } | null;
  ejecuciones: number;
  admite_decision: boolean;
  decision: { decision: string; motivo: string; por: string; en: string } | null;
}
interface Panel {
  estacion: { id: string; codigo: string };
  puede_decidir: boolean;
  pendientes: number;
  especialidades: { nombre: string; metodos: MetodoPanel[] }[];
}

const idDe = (codigo: string): string => {
  const id = metodo[codigo];
  if (id === undefined) throw new Error(`Sin método ${codigo}`);
  return id;
};

const panel = async (token: string) => {
  const r = await pedir(e, token, 'GET', `/estaciones/${estacionId}/metodos`);
  expect(r.statusCode).toBe(200);
  return r.json<Panel>();
};
const enPanel = (p: Panel, codigo: string): MetodoPanel => {
  const m = p.especialidades.flatMap((s) => s.metodos).find((x) => x.codigo === codigo);
  if (m === undefined) throw new Error(`El panel no trae ${codigo}`);
  return m;
};
const decidir = (
  token: string,
  codigo: string,
  decision: 'confirmar' | 'descartar',
  motivo = 'Verificado en la visita de reconocimiento',
) =>
  pedir(e, token, 'POST', `/estaciones/${estacionId}/metodos/${idDe(codigo)}/decision`, {
    decision,
    motivo,
  });
const reservasDe = (codigo: string) =>
  e.admin
    .selectFrom('reserva')
    .select(['id', 'estado', 'brigada_id'])
    .where('estacion_id', '=', estacionId)
    .where('metodo_id', '=', idDe(codigo))
    .execute();
const paquete = async () => {
  const r = await e.app.inject({
    method: 'GET',
    url: '/api/v1/paquete/campo',
    headers: conToken(campo.token),
  });
  expect(r.statusCode).toBe(200);
  return r.json<{
    reservas: { id: string; metodo_id: string }[];
    aplicabilidad: { estacion_id: string; metodo_id: string; habilitado: boolean }[];
  }>();
};

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  const c = o.coordinacion.token;
  proyectoId = (
    await pedir(e, c, 'POST', '/proyectos', {
      nombre: 'Métodos por estación',
      validacion_activa: false,
    })
  ).json<{ id: string }>().id;
  expect(
    (
      await pedir(e, c, 'POST', `/proyectos/${proyectoId}/configuracion/toce`, {
        incluir_a01: false,
      })
    ).statusCode,
  ).toBe(200);
  brigadaA = (
    await pedir(e, c, 'POST', `/proyectos/${proyectoId}/brigadas`, { nombre: 'Brigada M' })
  ).json<{ id: string }>().id;
  campo = await usuarioConDispositivo(e);
  jefeBrigada = await persona(e);
  for (const [usuario_id, rol] of [
    [campo.usuario.id, 'especialista'],
    [jefeBrigada.id, 'jefe_brigada'],
  ] as const) {
    expect(
      (await pedir(e, c, 'POST', `/brigadas/${brigadaA}/miembros`, { usuario_id, rol })).statusCode,
    ).toBe(201);
  }
  const est = await pedir(e, c, 'POST', `/proyectos/${proyectoId}/estaciones`, {
    codigo: 'MET-01',
    zona_utm: '18S',
    este: 450_000,
    norte: 8_900_000,
    aid_aii: 'AID',
    uv: 'Pajonal de puna',
    za_ef: null,
    region: 'SIERRA',
  });
  expect(est.statusCode).toBe(201);
  estacionId = est.json<{ id: string }>().id;
  const ruta = `/proyectos/${proyectoId}/cronograma/borrador`;
  expect(
    (
      await pedir(e, c, 'POST', ruta, {
        brigada_id: brigadaA,
        fecha: '2026-11-10',
        tipo_actividad: 'estacion',
        estacion_id: estacionId,
      })
    ).statusCode,
  ).toBe(201);
  expect((await pedir(e, c, 'POST', `${ruta}/publicar`)).statusCode).toBe(201);
  const ms = await e.admin
    .selectFrom('metodo as m')
    .innerJoin('configuracion_metodologica as k', 'k.id', 'm.configuracion_id')
    .select(['m.id', 'm.codigo'])
    .where('k.proyecto_id', '=', proyectoId)
    .where('k.estado', '=', 'vigente')
    .execute();
  for (const m of ms) metodo[m.codigo] = m.id;
}, 240_000);
afterAll(async () => {
  await e.cerrar();
});

describe('panel «Métodos a ejecutar» de una estación', () => {
  it('RN-28 agrupa por especialidad con clase, estado en la matriz, condición y resumen D01', async () => {
    const p = await panel(o.coordinacion.token);
    expect(p.estacion.codigo).toBe('MET-01');
    expect(p.puede_decidir).toBe(true);
    expect(p.especialidades.length).toBeGreaterThan(1);
    const todas = enPanel(p, 'flora_vegetacion.puntos_intercepcion');
    expect(todas).toMatchObject({ clase: 'todas', estado: 'aplicable', admite_decision: false });
    expect(todas.reserva?.estado).toBe('asignada');
    expect(todas.resumen_d01?.map((r) => r.clave)).toEqual(
      expect.arrayContaining(['objetivo', 'geometria', 'track', 'fotos_contexto']),
    );
    expect(enPanel(p, 'flora_vegetacion.parcelas_arbustos')).toMatchObject({
      clase: 'condicional',
      estado: 'condicion_pendiente',
      admite_decision: true,
      reserva: null,
    });
    expect(enPanel(p, 'flora_vegetacion.parcelas_arbustos').condicion_d01).not.toBe('');
    // SIERRA: la condición «región selva» de D01 no se cumple.
    expect(enPanel(p, 'aves.listas_20').estado).toBe('no_aplica');
    expect(enPanel(p, 'aves.registros_oportunos')).toMatchObject({
      estado: 'evento',
      reserva: null,
    });
    expect(enPanel(p, 'flora_vegetacion.formas_crecimiento_fenologia').estado).toBe('atributo');
    expect(p.pendientes).toBeGreaterThan(0);
  });

  it('alcance: el especialista de la brigada lo ve sin poder decidir; otro proyecto y Admin, 404', async () => {
    const p = await panel(campo.token);
    expect(p.puede_decidir).toBe(false);
    for (const t of [o.especialista.token, o.jefeA.token, o.admin.token]) {
      expect((await pedir(e, t, 'GET', `/estaciones/${estacionId}/metodos`)).statusCode).toBe(404);
    }
    expect(
      (await pedir(e, o.coordinacion.token, 'GET', `/estaciones/${generarId()}/metodos`))
        .statusCode,
    ).toBe(404);
  });
});

describe('decisión nominal estación–método (P-01)', () => {
  it('RN-28 confirmar un condicional pendiente lo deja aplicable y crea la reserva una sola vez', async () => {
    const c = 'flora_vegetacion.parcelas_arbustos';
    const r1 = await decidir(o.coordinacion.token, c, 'confirmar');
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({
      estado: 'aplicable',
      reserva_creada: true,
      reserva: { estado: 'asignada' },
    });
    const r2 = await decidir(o.jefeProyecto.token, c, 'confirmar', 'Ratificado por el JdP');
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toMatchObject({ reserva_creada: false });
    const reservas = await reservasDe(c);
    expect(reservas).toHaveLength(1);
    expect(reservas[0]?.brigada_id).toBe(brigadaA);

    const m = enPanel(await panel(o.coordinacion.token), c);
    expect(m).toMatchObject({ estado: 'aplicable', origen: 'nominal' });
    expect(m.decision).toMatchObject({ decision: 'confirmar', motivo: 'Ratificado por el JdP' });
    expect(m.decision?.por).not.toBe('');
    const historial = await e.admin
      .selectFrom('estacion_metodo_decision as d')
      .innerJoin('estacion_metodo as em', 'em.id', 'd.estacion_metodo_id')
      .select(['d.decision', 'd.creado_por', 'd.condicion_pendiente_anterior'])
      .where('em.estacion_id', '=', estacionId)
      .where('em.metodo_id', '=', idDe(c))
      .orderBy('d.creado_en')
      .execute();
    expect(historial).toHaveLength(2);
    expect(historial[0]).toMatchObject({
      creado_por: o.coordinacion.id,
      condicion_pendiente_anterior: true,
    });
    expect((await paquete()).reservas.map((x) => x.id)).toContain(reservas[0]?.id);
  });

  it('RN-28 un TODAS o el ABS no se descartan (409 METODO_OBLIGATORIO); un EVENTO no se decide', async () => {
    for (const c of ['flora_vegetacion.puntos_intercepcion', 'fauna_transversal.abs']) {
      const r = await decidir(o.coordinacion.token, c, 'descartar');
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ codigo: 'METODO_OBLIGATORIO' });
    }
    const ev = await decidir(o.coordinacion.token, 'aves.registros_oportunos', 'descartar');
    expect(ev.statusCode).toBe(409);
    expect(ev.json()).toMatchObject({ codigo: 'DECISION_NO_APLICA' });
    expect((await reservasDe('flora_vegetacion.puntos_intercepcion'))[0]?.estado).toBe('asignada');
  });

  it('el motivo es obligatorio (3–500 caracteres)', async () => {
    const c = 'flora_vegetacion.parcelas_arboles';
    expect((await decidir(o.coordinacion.token, c, 'confirmar', ' a ')).statusCode).toBe(400);
    expect((await decidir(o.coordinacion.token, c, 'confirmar', 'x'.repeat(501))).statusCode).toBe(
      400,
    );
    const sin = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/estaciones/${estacionId}/metodos/${idDe(c)}/decision`,
      { decision: 'confirmar' },
    );
    expect(sin.statusCode).toBe(400);
  });

  it('descartar un método con ejecuciones responde 409 TIENE_EJECUCIONES', async () => {
    const c = 'flora_vegetacion.parcelas_arboles';
    const conf = await decidir(o.coordinacion.token, c, 'confirmar');
    expect(conf.statusCode).toBe(200);
    const reservaId = conf.json<{ reserva: { id: string } }>().reserva.id;
    const r = await lote(e, campo.token, [
      abrir(generarId(), { reservaId, estacionId, metodoId: idDe(c) }),
    ]);
    expect(r[0]?.estado).toBe('aplicado');
    const d = await decidir(o.coordinacion.token, c, 'descartar');
    expect(d.statusCode).toBe(409);
    expect(d.json()).toMatchObject({ codigo: 'TIENE_EJECUCIONES' });
    expect((await reservasDe(c))[0]?.estado).toBe('asignada');
  });

  it('RN-28 descartar sin ejecuciones no borra la reserva: queda descartada y sale del paquete de campo', async () => {
    const c = 'aves.puntos_conteo';
    const antes = await reservasDe(c);
    expect(antes).toHaveLength(1);
    expect((await paquete()).reservas.map((x) => x.id)).toContain(antes[0]?.id);

    const r = await decidir(o.coordinacion.token, c, 'descartar', 'Estación sin hábitat de aves');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ estado: 'descartado', reserva: { estado: 'descartada' } });
    const despues = await reservasDe(c);
    expect(despues).toEqual([expect.objectContaining({ id: antes[0]?.id, estado: 'descartada' })]);

    const p = await paquete();
    expect(p.reservas.map((x) => x.id)).not.toContain(antes[0]?.id);
    expect(
      p.aplicabilidad.find((a) => a.estacion_id === estacionId && a.metodo_id === idDe(c))
        ?.habilitado,
    ).toBe(false);
    expect(enPanel(await panel(o.coordinacion.token), c)).toMatchObject({
      estado: 'descartado',
      decision: { decision: 'descartar', motivo: 'Estación sin hábitat de aves' },
    });
    // No cuenta en el avance de la estación.
    const avance = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${proyectoId}/estaciones/avance`)
    ).json<{ estaciones: { id: string; metodos: { metodo_id: string }[] }[] }>();
    const fila = avance.estaciones.find((x) => x.id === estacionId);
    expect(fila?.metodos.map((x) => x.metodo_id)).not.toContain(idDe(c));
  });

  it('RN-28 corregir los atributos de la estación rederiva la matriz sin pisar las decisiones nominales', async () => {
    const r = await pedir(e, o.coordinacion.token, 'PATCH', `/estaciones/${estacionId}`, {
      codigo: 'MET-01',
      zona_utm: '18S',
      este: 450_100,
      norte: 8_900_100,
      aid_aii: 'AID',
      uv: 'Pajonal de puna húmedo',
      za_ef: null,
      region: 'SIERRA',
    });
    expect(r.statusCode).toBe(200);
    const p = await panel(o.coordinacion.token);
    expect(enPanel(p, 'aves.puntos_conteo')).toMatchObject({
      estado: 'descartado',
      origen: 'nominal',
    });
    expect(enPanel(p, 'flora_vegetacion.parcelas_arbustos').estado).toBe('aplicable');
    expect(await reservasDe('aves.puntos_conteo')).toEqual([
      expect.objectContaining({ estado: 'descartada' }),
    ]);
  });

  it('RN-28 volver a confirmar un descartado reactiva la misma reserva', async () => {
    const c = 'aves.puntos_conteo';
    const antes = await reservasDe(c);
    const r = await decidir(o.jefeProyecto.token, c, 'confirmar', 'Se verificó hábitat de aves');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ reserva_creada: false, reserva: { estado: 'asignada' } });
    const despues = await reservasDe(c);
    expect(despues).toEqual([expect.objectContaining({ id: antes[0]?.id, estado: 'asignada' })]);
    expect((await paquete()).reservas.map((x) => x.id)).toContain(antes[0]?.id);
  });

  it('negativos: especialista, Jefe de Brigada y Admin no deciden (403); método de otro proyecto, 404', async () => {
    for (const t of [campo.token, jefeBrigada.token, o.admin.token, o.supervisorA.token]) {
      expect((await decidir(t, 'flora_vegetacion.parcelas_arbustos', 'descartar')).statusCode).toBe(
        403,
      );
    }
    const otro = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/estaciones/${estacionId}/metodos/${o.esc.metodoId}/decision`,
      { decision: 'confirmar', motivo: 'Método de otro proyecto' },
    );
    expect(otro.statusCode).toBe(404);
    const sinEstacion = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/estaciones/${o.esc.estacionId}/metodos/${idDe('aves.listas_20')}/decision`,
      { decision: 'confirmar', motivo: 'Estación de otro proyecto' },
    );
    expect(sinEstacion.statusCode).toBe(404);
  });
});
