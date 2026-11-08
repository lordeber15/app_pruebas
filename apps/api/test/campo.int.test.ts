import { cargarToce } from '@campo/db/toce';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  conToken,
  enviarLote,
  iniciarEntorno,
  usuarioConDispositivo,
  type Entorno,
} from './entorno.ts';

/**
 * Paquete de campo TOCE y eventos de ejecución (RF-M01, RF-M04, RF-M11, RN-05, RN-19, RN-24,
 * RN-25, RN-29, RN-30). Se carga la semilla real de D01 y A01 en un proyecto sintético.
 */
let e: Entorno;
let proyectoId: string;

const HORA = '2026-12-02T19:10:00.000-05:00';
const HASH = 'cd'.repeat(32);

beforeAll(async () => {
  e = await iniciarEntorno();
  proyectoId = generarId();
  await e.admin
    .insertInto('proyecto')
    .values({ id: proyectoId, nombre: 'TOCE (prueba)', validacion_activa: false })
    .execute();
  await cargarToce(e.admin as unknown as Kysely<unknown>, { proyectoId });
}, 240_000);
afterAll(async () => {
  await e.cerrar();
});

const brigada = async (codigo: string) =>
  (
    await e.admin
      .selectFrom('brigada')
      .select('id')
      .where('proyecto_id', '=', proyectoId)
      .where('codigo', '=', codigo)
      .executeTakeFirstOrThrow()
  ).id;

const miembroDe = async (codigoBrigada: string) => {
  const d = await usuarioConDispositivo(e);
  await e.admin
    .insertInto('miembro_brigada')
    .values({
      id: generarId(),
      brigada_id: await brigada(codigoBrigada),
      usuario_id: d.usuario.id,
      rol: 'especialista',
    })
    .execute();
  return d;
};

interface Paquete {
  brigadas: { id: string; codigo: string; region: string | null }[];
  cronograma: { brigada_id: string; fecha: string; estacion_id: string | null }[];
  estaciones: {
    id: string;
    codigo: string;
    zona_utm: string | null;
    este: number | null;
    norte: number | null;
    aid_aii: string | null;
    uv: string | null;
    za_ef: string | null;
    lat: number;
    lon: number;
  }[];
  especialidades: { id: string; codigo: string }[];
  metodos: { id: string; codigo: string; clase: string; config: { codigo: string } }[];
  aplicabilidad: { estacion_id: string; metodo_id: string; habilitado: boolean }[];
  reservas: { id: string; estacion_id: string; metodo_id: string; brigada_id: string }[];
}

const paquete = async (token: string) => {
  const r = await e.app.inject({
    method: 'GET',
    url: '/api/v1/paquete/campo',
    headers: conToken(token),
  });
  return { status: r.statusCode, cuerpo: r.json<Paquete>(), crudo: r.body };
};

const sobre = <P>(tipo: string, entidad: { tipo: string; id: string }, payload: P) => ({
  id: generarId(),
  tipo,
  version_esquema: 1,
  entidad,
  hora_dispositivo: HORA,
  ubicacion: { lat: -10.1, lon: -75.2, precision_m: 6 },
  payload,
});

const abrir = (
  ejecucionId: string,
  r: { id: string | null; estacion_id: string; metodo_id: string },
) =>
  sobre(
    'ejecucion_abierta',
    { tipo: 'ejecucion', id: ejecucionId },
    {
      ejecucion_id: ejecucionId,
      reserva_id: r.id,
      estacion_id: r.estacion_id,
      metodo_id: r.metodo_id,
      abierta_en: HORA,
    },
  );

const unidad = (ejecucionId: string, unidadId: string, extra: Record<string, unknown> = {}) =>
  sobre(
    'unidad_guardada',
    { tipo: 'unidad', id: unidadId },
    {
      unidad_id: unidadId,
      ejecucion_id: ejecucionId,
      codigo: 'T-01',
      tipo_unidad: 'transecto',
      orden: 0,
      estado: 'cerrada',
      geometria: {
        tipo: 'inicio_fin',
        inicio: { lat: -10.1, lon: -75.2 },
        fin: { lat: -10.101, lon: -75.2 },
      },
      inicio: '2026-12-02T19:00:00.000-05:00',
      fin: '2026-12-02T19:40:00.000-05:00',
      datos: { habitat: 'Bosque de colina' },
      registros: [{ especie: 'Akodon sp.', n_individuos: 1 }],
      unidad_vinculada_id: null,
      parametros_confirmados: [],
      ...extra,
    },
  );

const cerrar = (
  ejecucionId: string,
  archivoIds: string[],
  desviacion = { tipo: 'ninguna', explicacion: null as string | null },
) =>
  sobre(
    'ejecucion_cerrada',
    { tipo: 'ejecucion', id: ejecucionId },
    {
      ejecucion_id: ejecucionId,
      cerrada_en: '2026-12-02T20:00:00.000-05:00',
      datos: {},
      desviacion,
      confirmaciones: [],
      objetivo_campo: null,
      archivo_ids: archivoIds,
    },
  );

const foto = (ejecucionId: string, unidadId: string | null, archivoId = generarId()) =>
  sobre(
    'archivo_capturado',
    { tipo: 'archivo', id: archivoId },
    {
      archivo_id: archivoId,
      tipo: 'foto',
      hash_preview: HASH,
      hash_original: null,
      tamanos: { preview: 800_000, original: null },
      capturado_en: HORA,
      ejecucion_id: ejecucionId,
      unidad_id: unidadId,
      tipo_foto: 'contexto',
      orientacion: 'N',
      candidata_reporte: true,
    },
  );

type Resultado = { id: string; estado: string; motivo?: string };
const lote = async (token: string, eventos: unknown[]) => {
  const r = await enviarLote(e, token, eventos);
  expect(r.statusCode).toBe(200);
  return r.json<{ resultados: Resultado[] }>().resultados;
};

describe('RF-M01 paquete de campo TOCE', () => {
  it('RN-25 RN-29 trae solo lo de la brigada del usuario, con los atributos de A01 y sin usuarios', async () => {
    const yo = await miembroDe('SELVA 2');
    const { status, cuerpo, crudo } = await paquete(yo.token);
    expect(status).toBe(200);
    const selva2 = await brigada('SELVA 2');
    expect(cuerpo.brigadas.map((b) => b.codigo)).toEqual(['SELVA 2']);
    expect(cuerpo.cronograma.length).toBeGreaterThan(0);
    expect(cuerpo.cronograma.every((i) => i.brigada_id === selva2)).toBe(true);
    expect(cuerpo.reservas.length).toBeGreaterThan(0);
    expect(cuerpo.reservas.every((r) => r.brigada_id === selva2)).toBe(true);
    expect(cuerpo.metodos).toHaveLength(33);
    expect(cuerpo.especialidades).toHaveLength(12);
    const est = cuerpo.estaciones[0];
    expect(est).toBeDefined();
    expect(est?.zona_utm).toMatch(/^1[78] ?S$/);
    expect(typeof est?.este).toBe('number');
    expect(est?.lat).toBeLessThan(0);
    // RN-25: el paquete no lleva usuarios ni datos personales.
    expect(crudo).not.toMatch(/usuario_id|num_documento|nombre_completo|username/);
    expect(crudo).not.toContain(yo.usuario.username);
  });

  it('negativo: un usuario sin brigada recibe 403', async () => {
    const otro = await usuarioConDispositivo(e);
    expect((await paquete(otro.token)).status).toBe(403);
  });
});

describe('RN-05 ciclo de una ejecución desde el celular', () => {
  it('abrir, guardar la unidad con su geometría, track, foto y cerrar deja la ejecución en evidencia pendiente', async () => {
    const yo = await miembroDe('SELVA 2');
    const p = (await paquete(yo.token)).cuerpo;
    const sherman = p.metodos.find((m) => m.codigo === 'mamiferos_menores_terrestres.sherman');
    const reserva = p.reservas.find((r) => r.metodo_id === sherman?.id);
    expect(reserva).toBeDefined();
    if (reserva === undefined) return;
    const ejecucionId = generarId();
    const unidadId = generarId();
    const trackId = generarId();
    const f = foto(ejecucionId, unidadId);
    const eventos = [
      abrir(ejecucionId, reserva),
      unidad(ejecucionId, unidadId),
      sobre(
        'track_registrado',
        { tipo: 'track', id: trackId },
        {
          track_id: trackId,
          ejecucion_id: ejecucionId,
          unidad_id: unidadId,
          puntos: [
            {
              lat: -10.1,
              lon: -75.2,
              altitud_m: 400,
              precision_m: 5,
              hora: '2026-12-02T19:00:00.000-05:00',
            },
            {
              lat: -10.1005,
              lon: -75.2,
              altitud_m: 401,
              precision_m: 5,
              hora: '2026-12-02T19:20:00.000-05:00',
            },
            {
              lat: -10.101,
              lon: -75.2,
              altitud_m: 402,
              precision_m: 5,
              hora: '2026-12-02T19:40:00.000-05:00',
            },
          ],
        },
      ),
      f,
      cerrar(ejecucionId, [f.payload.archivo_id]),
    ];
    const r = await lote(yo.token, eventos);
    expect(r.map((x) => x.estado)).toEqual([
      'aplicado',
      'aplicado',
      'aplicado',
      'aplicado',
      'aplicado',
    ]);

    const ej = await e.admin
      .selectFrom('ejecucion')
      .selectAll()
      .where('id', '=', ejecucionId)
      .executeTakeFirstOrThrow();
    expect(ej).toMatchObject({
      estado: 'evidencia_pendiente',
      usuario_id: yo.usuario.id,
      dispositivo_id: yo.dispositivoId,
      reserva_id: reserva.id,
    });
    const u = await e.admin
      .selectFrom('unidad')
      .select([
        'codigo',
        'registros',
        (eb) => eb.fn<string>('ST_GeometryType', ['geom']).as('tipo_geom'),
      ])
      .where('id', '=', unidadId)
      .executeTakeFirstOrThrow();
    expect(u).toMatchObject({
      codigo: 'T-01',
      tipo_geom: 'ST_LineString',
      registros: [{ especie: 'Akodon sp.', n_individuos: 1 }],
    });
    const t = await e.admin
      .selectFrom('track')
      .select(['unidad_id'])
      .where('id', '=', trackId)
      .executeTakeFirstOrThrow();
    expect(t.unidad_id).toBe(unidadId);
    const a = await e.admin
      .selectFrom('archivo')
      .select([
        'ejecucion_id',
        'unidad_id',
        'tipo_foto',
        'orientacion',
        'estacion_id',
        'metodo_id',
        'candidata_reporte',
      ])
      .where('id', '=', f.payload.archivo_id)
      .executeTakeFirstOrThrow();
    expect(a).toEqual({
      ejecucion_id: ejecucionId,
      unidad_id: unidadId,
      tipo_foto: 'contexto',
      orientacion: 'N',
      estacion_id: reserva.estacion_id,
      metodo_id: reserva.metodo_id,
      candidata_reporte: true,
    });

    // RN-10: reenviar el lote no duplica.
    expect((await lote(yo.token, eventos)).map((x) => x.estado)).toEqual([
      'ya_aplicado',
      'ya_aplicado',
      'ya_aplicado',
      'ya_aplicado',
      'ya_aplicado',
    ]);
  });

  it('RN-19 dos especialistas de la brigada registran su propia ejecución del mismo método', async () => {
    const a = await miembroDe('SELVA 3');
    const b = await miembroDe('SELVA 3');
    const reserva = (await paquete(a.token)).cuerpo.reservas[0];
    if (reserva === undefined) throw new Error('sin reservas');
    expect((await lote(a.token, [abrir(generarId(), reserva)]))[0]?.estado).toBe('aplicado');
    expect((await lote(b.token, [abrir(generarId(), reserva)]))[0]?.estado).toBe('aplicado');
    const n = await e.admin
      .selectFrom('ejecucion')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('reserva_id', '=', reserva.id)
      .executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(2);
  });

  it('RN-13 una unidad que llega con la ejecución cerrada queda en revisión y no la reabre', async () => {
    const yo = await miembroDe('SELVA 1');
    const reserva = (await paquete(yo.token)).cuerpo.reservas[0];
    if (reserva === undefined) throw new Error('sin reservas');
    const ejecucionId = generarId();
    await lote(yo.token, [abrir(ejecucionId, reserva), cerrar(ejecucionId, [])]);
    const tardia = await lote(yo.token, [unidad(ejecucionId, generarId())]);
    expect(tardia[0]).toMatchObject({ estado: 'en_revision', motivo: 'EJECUCION_CERRADA' });
    const ej = await e.admin
      .selectFrom('ejecucion')
      .select('estado')
      .where('id', '=', ejecucionId)
      .executeTakeFirstOrThrow();
    expect(ej.estado).toBe('evidencia_pendiente');
  });

  it('RN-40 un EVENTO se registra sin reserva; un método con reserva no', async () => {
    const yo = await miembroDe('SELVA 4');
    const p = (await paquete(yo.token)).cuerpo;
    const est = p.estaciones[0];
    const evento = p.metodos.find((m) => m.codigo === 'aves.registros_oportunos');
    const todas = p.metodos.find((m) => m.codigo === 'mamiferos_mayores.camaras_trampa');
    if (est === undefined || evento === undefined || todas === undefined) throw new Error('datos');
    const r = await lote(yo.token, [
      abrir(generarId(), { id: null, estacion_id: est.id, metodo_id: evento.id }),
      abrir(generarId(), { id: null, estacion_id: est.id, metodo_id: todas.id }),
    ]);
    expect(r.map((x) => [x.estado, x.motivo ?? null])).toEqual([
      ['aplicado', null],
      ['no_aplicado', 'RESERVA_REQUERIDA'],
    ]);
  });
});

describe('negativos de alcance de la ejecución', () => {
  it('otra brigada: la reserva de SELVA 2 no se puede ejecutar desde COSTA', async () => {
    const selva = await miembroDe('SELVA 2');
    const costa = await miembroDe('COSTA');
    const ajena = (await paquete(selva.token)).cuerpo.reservas[0];
    if (ajena === undefined) throw new Error('sin reservas');
    const r = await lote(costa.token, [abrir(generarId(), ajena)]);
    expect(r[0]).toMatchObject({ estado: 'no_aplicado', motivo: 'FUERA_DE_ALCANCE' });
  });

  it('otro usuario: no puede agregar unidades, tracks ni fotos a una ejecución ajena', async () => {
    const duena = await miembroDe('SIERRA 1');
    const intruso = await miembroDe('SIERRA 1');
    const reserva = (await paquete(duena.token)).cuerpo.reservas[0];
    if (reserva === undefined) throw new Error('sin reservas');
    const ejecucionId = generarId();
    await lote(duena.token, [abrir(ejecucionId, reserva)]);
    const trackId = generarId();
    const r = await lote(intruso.token, [
      unidad(ejecucionId, generarId()),
      foto(ejecucionId, null),
      cerrar(ejecucionId, []),
      sobre(
        'track_registrado',
        { tipo: 'track', id: trackId },
        {
          track_id: trackId,
          ejecucion_id: ejecucionId,
          unidad_id: null,
          puntos: [
            { lat: -10, lon: -75, altitud_m: null, precision_m: null, hora: HORA },
            { lat: -10.001, lon: -75, altitud_m: null, precision_m: null, hora: HORA },
          ],
        },
      ),
    ]);
    expect(r.map((x) => x.motivo)).toEqual([
      'EJECUCION_AJENA',
      'EJECUCION_AJENA',
      'EJECUCION_AJENA',
      'EJECUCION_AJENA',
    ]);
  });

  it('RF-M11 una desviación sin explicación no pasa el esquema; otro proyecto: estación y método de proyectos distintos', async () => {
    const yo = await miembroDe('SIERRA 2');
    const reserva = (await paquete(yo.token)).cuerpo.reservas[0];
    if (reserva === undefined) throw new Error('sin reservas');
    const ejecucionId = generarId();
    const r = await lote(yo.token, [
      abrir(ejecucionId, reserva),
      cerrar(ejecucionId, [], { tipo: 'parcial', explicacion: ' ' }),
    ]);
    expect(r[1]).toMatchObject({ estado: 'no_aplicado', motivo: 'ESQUEMA_INVALIDO' });

    const otroProyecto = generarId();
    const estacionAjena = generarId();
    await e.admin
      .insertInto('proyecto')
      .values({ id: otroProyecto, nombre: 'Otro', validacion_activa: false })
      .execute();
    await e.admin
      .insertInto('estacion')
      .values({
        id: estacionAjena,
        proyecto_id: otroProyecto,
        codigo: 'X-1',
        geom: sql<string>`ST_SetSRID(ST_MakePoint(-75, -10), 4326)`,
      })
      .execute();
    const r2 = await lote(yo.token, [
      abrir(generarId(), { id: null, estacion_id: estacionAjena, metodo_id: reserva.metodo_id }),
    ]);
    expect(r2[0]).toMatchObject({ estado: 'no_aplicado', motivo: 'REFERENCIA_INVALIDA' });
  });
});
