import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  cerrar,
  enCampo,
  foto,
  iniciarEntorno,
  lote,
  nuevoEscenario,
  organizacion,
  pedir,
  sobre,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

/**
 * Ejecuciones en la web (D02 §11, E-02, E-04, E-05) y su alcance: Coordinación y JdP todo; JdB y
 * Supervisor de campo su brigada; el especialista solo lo suyo; el Administrador técnico nada
 * (ERS §2.3, `consultar_seguimiento`). Cada endpoint con pruebas negativas: otro proyecto, otra
 * brigada y otro rol.
 */
let e: Entorno;
let o: Organizacion;
/** Especialistas con dispositivo: dos en la brigada A y uno en la B. */
let campoA1: Awaited<ReturnType<typeof enCampo>>;
let campoA2: Awaited<ReturnType<typeof enCampo>>;
let campoB: Awaited<ReturnType<typeof enCampo>>;
let ejA1: string;
let ejA2: string;
let ejB: string;
let unidadA1: string;

const unidad = (ejecucionId: string, unidadId: string) =>
  sobre(
    'unidad_guardada',
    { tipo: 'unidad', id: unidadId },
    {
      unidad_id: unidadId,
      ejecucion_id: ejecucionId,
      codigo: 'T-01',
      tipo_unidad: 'trampa',
      orden: 0,
      estado: 'cerrada',
      geometria: { tipo: 'punto', punto: { lat: -10.1, lon: -75.2 } },
      inicio: '2026-12-02T19:00:00.000-05:00',
      fin: '2026-12-02T19:40:00.000-05:00',
      datos: { cebo: 'Avena' },
      registros: [],
      unidad_vinculada_id: null,
      parametros_confirmados: [],
    },
  );

const track = (ejecucionId: string, unidadId: string) => {
  const id = generarId();
  return sobre(
    'track_registrado',
    { tipo: 'track', id },
    {
      track_id: id,
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
          hora: '2026-12-02T19:05:00.000-05:00',
        },
      ],
    },
  );
};

/** Ejecución completa enviada desde el celular: apertura, unidad, track, foto y cierre. */
const ejecucionEnviada = async (
  yo: { token: string },
  r: { reservaId: string | null; estacionId: string; metodoId: string },
) => {
  const ejecucionId = generarId();
  const unidadId = generarId();
  const archivoId = generarId();
  const res = await lote(e, yo.token, [
    abrir(ejecucionId, r),
    unidad(ejecucionId, unidadId),
    track(ejecucionId, unidadId),
    foto(ejecucionId, unidadId, archivoId),
    cerrar(ejecucionId, [archivoId]),
  ]);
  if (res.some((x) => x.estado !== 'aplicado')) throw new Error(JSON.stringify(res));
  return { ejecucionId, unidadId, archivoId };
};

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  [campoA1, campoA2, campoB] = await Promise.all([
    enCampo(e, o.esc.brigadaId),
    enCampo(e, o.esc.brigadaId),
    enCampo(e, o.esc.brigadaB),
  ]);
  const a1 = await ejecucionEnviada(campoA1, o.esc);
  ejA1 = a1.ejecucionId;
  unidadA1 = a1.unidadId;
  ejA2 = (await ejecucionEnviada(campoA2, o.esc)).ejecucionId;
  // En la brigada B, un EVENTO (sin reserva): queda en la brigada del usuario.
  ejB = (
    await ejecucionEnviada(campoB, {
      reservaId: null,
      estacionId: o.esc.estacionId,
      metodoId: o.esc.eventoId,
    })
  ).ejecucionId;
  // Resultado de QA como lo deja el worker (D02 §9).
  await e.admin
    .updateTable('ejecucion')
    .set({
      estado: 'parcial',
      resultado_qa: JSON.stringify({
        resultados: [
          {
            regla: 'fotos_contexto',
            tipo_control: 'obligatorio',
            estado: 'incumple',
            mensaje: 'T-01: 0 de 8 fotos de contexto',
            texto_d01: 'Validar fotos (8 por transecto).',
            unidad_id: unidadA1,
            esperado: 8,
            obtenido: 0,
          },
        ],
        incumplimientos_obligatorios: 1,
        advertencias: 0,
      }),
      qa_evaluado_en: new Date(),
    })
    .where('id', '=', ejA1)
    .execute();
});
afterAll(async () => {
  await e.cerrar();
});

type Fila = {
  id: string;
  estado: string;
  estacion_codigo: string;
  metodo_nombre: string;
  especialidad_nombre: string;
  usuario_nombre: string;
  brigada_nombre: string | null;
  unidades: number;
  incumplimientos_obligatorios: number | null;
  ultima_recepcion: string | null;
  desviacion_tipo: string;
};

const listar = async (token: string, consulta = '') => {
  const r = await pedir(e, token, 'GET', `/proyectos/${o.esc.proyectoId}/ejecuciones${consulta}`);
  return {
    estado: r.statusCode,
    ids: r.statusCode === 200 ? r.json<{ ejecuciones: Fila[] }>().ejecuciones.map((x) => x.id) : [],
    r,
  };
};

describe('GET /proyectos/:id/ejecuciones (D02 §11)', () => {
  it('Coordinación y JdP ven las ejecuciones de todas las brigadas', async () => {
    for (const p of [o.coordinacion, o.jefeProyecto]) {
      const { estado, ids } = await listar(p.token);
      expect(estado).toBe(200);
      expect(ids).toEqual(expect.arrayContaining([ejA1, ejA2, ejB]));
    }
  });

  it('la fila trae estación, método, especialidad, usuario, brigada, unidades, QA y última recepción', async () => {
    const { r } = await listar(o.coordinacion.token);
    const fila = r.json<{ ejecuciones: Fila[] }>().ejecuciones.find((x) => x.id === ejA1);
    expect(fila).toMatchObject({
      estado: 'parcial',
      estacion_codigo: expect.stringMatching(/^EST-/) as unknown,
      metodo_nombre: 'Trampas Sherman',
      especialidad_nombre: 'Mamíferos',
      unidades: 1,
      incumplimientos_obligatorios: 1,
      desviacion_tipo: 'ninguna',
    });
    expect(fila?.brigada_nombre).toMatch(/^Brigada A/);
    expect(fila?.ultima_recepcion).not.toBeNull();
  });

  it('JdB y Supervisor de campo ven solo su brigada (otra brigada: no)', async () => {
    for (const p of [o.jefeA, o.supervisorA]) {
      const { estado, ids } = await listar(p.token);
      expect(estado).toBe(200);
      expect(ids).toEqual(expect.arrayContaining([ejA1, ejA2]));
      expect(ids).not.toContain(ejB);
    }
    const b = await listar(o.jefeB.token);
    expect(b.ids).toContain(ejB);
    expect(b.ids).not.toContain(ejA1);
  });

  it('el especialista solo ve sus propias ejecuciones', async () => {
    const { estado, ids } = await listar(campoA1.token);
    expect(estado).toBe(200);
    expect(ids).toEqual([ejA1]);
    // Un especialista de la brigada sin ejecuciones propias no ve las de sus compañeros.
    expect((await listar(o.especialista.token)).ids).toEqual([]);
  });

  it('filtra por brigada, estación y estado', async () => {
    expect((await listar(o.coordinacion.token, `?brigada=${o.esc.brigadaB}`)).ids).toEqual([ejB]);
    expect((await listar(o.coordinacion.token, '?estado=parcial')).ids).toEqual([ejA1]);
    const est = await listar(o.coordinacion.token, `?estacion=${o.esc.estacionId}`);
    expect(est.ids).toHaveLength(3);
    expect((await listar(o.coordinacion.token, '?estado=inventado')).estado).toBe(400);
  });

  it('otro rol: el Administrador técnico no ve ejecuciones', async () => {
    expect((await listar(o.admin.token)).estado).toBe(404);
  });

  it('otro proyecto: un miembro de este proyecto no ve el otro', async () => {
    const otro = await nuevoEscenario(e);
    const r = await pedir(e, o.jefeA.token, 'GET', `/proyectos/${otro.proyectoId}/ejecuciones`);
    expect(r.statusCode).toBe(404);
    // Coordinación sí ve el proyecto, aunque no tenga ejecuciones.
    const c = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${otro.proyectoId}/ejecuciones`,
    );
    expect(c.statusCode).toBe(200);
    expect(c.json<{ ejecuciones: Fila[] }>().ejecuciones).toEqual([]);
  });

  it('sin sesión: 401', async () => {
    const r = await e.app.inject({
      method: 'GET',
      url: `/api/v1/proyectos/${o.esc.proyectoId}/ejecuciones`,
    });
    expect(r.statusCode).toBe(401);
  });
});

interface Detalle {
  id: string;
  estado: string;
  estacion_lat: number;
  estacion_lon: number;
  unidades: { id: string; codigo: string; geometria: { type: string; coordinates: number[] } }[];
  tracks: { id: string; puntos: number; geometria: { type: string; coordinates: number[][] } }[];
  fotos: { id: string; unidad_id: string | null; tipo_foto: string | null }[];
  resultado_qa: { incumplimientos_obligatorios: number } | null;
}

describe('GET /ejecuciones/:id (E-02, E-04, E-05)', () => {
  it('devuelve unidades y tracks en GeoJSON, fotos y el resultado de QA', async () => {
    const r = await pedir(e, o.coordinacion.token, 'GET', `/ejecuciones/${ejA1}`);
    expect(r.statusCode).toBe(200);
    const d = r.json<Detalle>();
    expect(d.estado).toBe('parcial');
    expect(d.estacion_lat).toBeCloseTo(-12.04);
    expect(d.unidades[0]).toMatchObject({
      id: unidadA1,
      codigo: 'T-01',
      geometria: { type: 'Point', coordinates: [-75.2, -10.1] },
    });
    expect(d.tracks).toHaveLength(1);
    expect(d.tracks[0]?.geometria.type).toBe('LineString');
    expect(d.tracks[0]?.puntos).toBe(2);
    expect(d.fotos).toEqual([
      expect.objectContaining({ unidad_id: unidadA1, tipo_foto: 'contexto' }),
    ]);
    expect(d.resultado_qa?.incumplimientos_obligatorios).toBe(1);
    expect(d).not.toHaveProperty('usuario_id');
  });

  it('JdB, Supervisor de campo y el propio especialista ven el detalle', async () => {
    for (const p of [o.jefeA, o.supervisorA, campoA1, o.jefeProyecto]) {
      expect((await pedir(e, p.token, 'GET', `/ejecuciones/${ejA1}`)).statusCode).toBe(200);
    }
  });

  it('otra brigada: el JdB de la B no ve una ejecución de la A', async () => {
    expect((await pedir(e, o.jefeB.token, 'GET', `/ejecuciones/${ejA1}`)).statusCode).toBe(404);
    expect((await pedir(e, o.jefeA.token, 'GET', `/ejecuciones/${ejB}`)).statusCode).toBe(404);
  });

  it('especialista: no ve la ejecución de un compañero de su brigada', async () => {
    expect((await pedir(e, campoA1.token, 'GET', `/ejecuciones/${ejA2}`)).statusCode).toBe(404);
  });

  it('otro rol: el Administrador técnico no ve el detalle', async () => {
    expect((await pedir(e, o.admin.token, 'GET', `/ejecuciones/${ejA1}`)).statusCode).toBe(404);
  });

  it('otro proyecto: un miembro de otro proyecto no ve la ejecución', async () => {
    const otro = await nuevoEscenario(e);
    const ajeno = await enCampo(e, otro.brigadaId, 'supervisor_campo');
    expect((await pedir(e, ajeno.token, 'GET', `/ejecuciones/${ejA1}`)).statusCode).toBe(404);
  });

  it('una ejecución inexistente o un id inválido no revelan nada', async () => {
    expect(
      (await pedir(e, o.coordinacion.token, 'GET', `/ejecuciones/${generarId()}`)).statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, o.coordinacion.token, 'GET', '/ejecuciones/no-es-uuid')).statusCode,
    ).toBe(400);
  });
});

describe('RF-T05 / T-10 esfuerzo planificado vs. ejecutado', () => {
  let ejT: string;
  beforeAll(async () => {
    ejT = generarId();
    const unidadId = generarId();
    const archivoId = generarId();
    const res = await lote(e, campoA1.token, [
      abrir(ejT, o.esc),
      unidad(ejT, unidadId),
      foto(ejT, unidadId, archivoId),
      cerrar(ejT, [archivoId], undefined, [
        {
          id: generarId(),
          tipo: 'falla',
          motivo: 'Batería del detector agotada',
          inicio: '2026-12-02T19:20:00.000-05:00',
          fin: '2026-12-02T19:35:00.000-05:00',
          unidad_id: unidadId,
        },
      ]),
    ]);
    if (res.some((x) => x.estado !== 'aplicado')) throw new Error(JSON.stringify(res));
  });

  it('T-10: el detalle trae inicio/fin, cantidad, duración efectiva e interrupciones con motivo', async () => {
    const r = await pedir(e, o.coordinacion.token, 'GET', `/ejecuciones/${ejT}`);
    expect(r.statusCode).toBe(200);
    const d = r.json<{
      esfuerzo: {
        ejecutado: {
          cantidad: number;
          inicio: string;
          fin: string | null;
          duracion_min: number | null;
          interrumpido_min: number;
          efectivo_min: number | null;
          fallas: number;
        };
      };
      interrupciones: { motivo: string; tipo: string }[];
    }>();
    expect(d.esfuerzo.ejecutado).toMatchObject({
      cantidad: 1,
      inicio: '2026-12-03T00:00:00.000Z',
      fin: '2026-12-03T01:00:00.000Z',
      duracion_min: 60,
      interrumpido_min: 15,
      efectivo_min: 45,
      fallas: 1,
    });
    expect(d.interrupciones).toEqual([
      expect.objectContaining({ tipo: 'falla', motivo: 'Batería del detector agotada' }),
    ]);
  });

  it('RN-19: seguimiento muestra una fila de esfuerzo por ejecución de cada usuario', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/seguimiento`,
    );
    expect(r.statusCode).toBe(200);
    const filas = r
      .json<{
        brigadas: {
          id: string;
          filas: {
            metodo_id: string;
            avance: { ejecutado: number } | null;
            esfuerzo_por_usuario: {
              ejecucion_id: string;
              esfuerzo: { ejecutado: { cantidad: number } };
            }[];
          }[];
        }[];
      }>()
      .brigadas.find((b) => b.id === o.esc.brigadaId)?.filas;
    const fila = filas?.find((f) => f.esfuerzo_por_usuario.some((x) => x.ejecucion_id === ejT));
    expect(fila).toBeDefined();
    const suma = fila?.esfuerzo_por_usuario.reduce((s, x) => s + x.esfuerzo.ejecutado.cantidad, 0);
    expect(suma).toBe(fila?.avance?.ejecutado);
    expect(fila?.esfuerzo_por_usuario.map((x) => x.ejecucion_id)).toEqual(
      expect.arrayContaining([ejA1, ejA2, ejT]),
    );
  });

  it('T-10: una interrupción sin motivo invalida el cierre (no_aplicado), sin perder el evento', async () => {
    const id = generarId();
    const res = await lote(e, campoA2.token, [
      abrir(id, o.esc),
      cerrar(id, [], undefined, [
        {
          id: generarId(),
          tipo: 'interrupcion',
          motivo: '',
          inicio: '2026-12-02T19:20:00.000-05:00',
          fin: null,
          unidad_id: null,
        },
      ]),
    ]);
    expect(res.map((x) => x.estado)).toEqual(['aplicado', 'no_aplicado']);
  });
});
