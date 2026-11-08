import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  enCampo,
  foto,
  iniciarEntorno,
  lote,
  nuevoEscenario,
  organizacion,
  pedir,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

/**
 * Galería (D02 §8 y §11): paginación por cursor estable, miniaturas firmadas en la respuesta y
 * agregado por estación para el mini mapa, con el mismo alcance que la lista (especialista solo
 * lo suyo, su brigada, otro proyecto).
 */
let e: Entorno;
let o: Organizacion;
let estacion2: string;
let duenio: Awaited<ReturnType<typeof enCampo>>;
let companero: Awaited<ReturnType<typeof enCampo>>;
let deB: Awaited<ReturnType<typeof enCampo>>;
let ajeno: Awaited<ReturnType<typeof enCampo>>;
const propiasEst1: string[] = [];
const propiasEst2: string[] = [];
let fotoB: string;
let conMiniatura: string;

interface Foto {
  id: string;
  capturado_en: string;
  estacion_id: string;
  miniatura_url: string | null;
}
interface Pagina {
  fotos: Foto[];
  siguiente: string | null;
}
interface EstacionGaleria {
  estacion_id: string;
  codigo: string;
  lat: number;
  lon: number;
  fotos: number;
}

/** Foto verificada en el servidor con el instante de captura indicado. */
const fotoVerificada = async (
  yo: { token: string },
  r: { reservaId: string | null; estacionId: string; metodoId: string },
  capturado: string,
) => {
  const ejecucionId = generarId();
  const archivoId = generarId();
  const res = await lote(e, yo.token, [abrir(ejecucionId, r), foto(ejecucionId, null, archivoId)]);
  if (res.some((x) => x.estado !== 'aplicado')) throw new Error(JSON.stringify(res));
  await e.admin
    .updateTable('archivo')
    .set({
      estado: 'preview_verificada',
      capturado_en: new Date(capturado),
      candidata_reporte: false,
    })
    .where('id', '=', archivoId)
    .execute();
  return archivoId;
};

const galeria = async (token: string, query = '', proyecto = o.esc.proyectoId) => {
  const r = await pedir(e, token, 'GET', `/proyectos/${proyecto}/galeria${query}`);
  return { status: r.statusCode, cuerpo: r.json<Pagina>() };
};

const estaciones = async (token: string, query = '', proyecto = o.esc.proyectoId) => {
  const r = await pedir(e, token, 'GET', `/proyectos/${proyecto}/galeria/estaciones${query}`);
  return { status: r.statusCode, cuerpo: r.json<{ estaciones: EstacionGaleria[] }>() };
};

const cuentas = (es: EstacionGaleria[]) =>
  Object.fromEntries(es.map((x) => [x.estacion_id, x.fotos]));

/** Recorre todas las páginas con el cursor. */
const todas = async (token: string, limite: number, extra = '') => {
  const ids: string[] = [];
  let cursor: string | null = null;
  let paginas = 0;
  do {
    const q: string = `?limite=${String(limite)}${extra}${cursor === null ? '' : `&cursor=${cursor}`}`;
    const r = await galeria(token, q);
    expect(r.status).toBe(200);
    expect(r.cuerpo.fotos.length).toBeLessThanOrEqual(limite);
    ids.push(...r.cuerpo.fotos.map((f) => f.id));
    cursor = r.cuerpo.siguiente;
    paginas++;
  } while (cursor !== null && paginas < 50);
  return { ids, paginas };
};

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  estacion2 = generarId();
  await e.admin
    .insertInto('estacion')
    .values({
      id: estacion2,
      proyecto_id: o.esc.proyectoId,
      codigo: 'EST-GAL-2',
      geom: sql<string>`ST_SetSRID(ST_MakePoint(-76.5, -11.5), 4326)`,
    })
    .execute();
  duenio = await enCampo(e, o.esc.brigadaId);
  companero = await enCampo(e, o.esc.brigadaId);
  deB = await enCampo(e, o.esc.brigadaB);
  const otro = await nuevoEscenario(e);
  ajeno = await enCampo(e, otro.brigadaId);

  // Cinco fotos en la estación 1; dos comparten el instante para probar el desempate por id.
  const instantes = [
    '2026-12-02T14:00:00.000Z',
    '2026-12-02T15:00:00.000Z',
    '2026-12-02T15:00:00.000Z',
    '2026-12-02T16:00:00.000Z',
    '2026-12-03T14:00:00.000Z',
  ];
  for (const t of instantes) propiasEst1.push(await fotoVerificada(duenio, o.esc, t));
  // Dos en la estación 2 con el método EVENTO (sin reserva).
  const evento2 = { reservaId: null, estacionId: estacion2, metodoId: o.esc.eventoId };
  for (const t of ['2026-12-02T17:00:00.000Z', '2026-12-02T18:00:00.000Z']) {
    propiasEst2.push(await fotoVerificada(duenio, evento2, t));
  }
  // Una de la brigada B en la estación 1 y una de otro proyecto.
  const evento1 = { reservaId: null, estacionId: o.esc.estacionId, metodoId: o.esc.eventoId };
  fotoB = await fotoVerificada(deB, evento1, '2026-12-02T12:00:00.000Z');
  await fotoVerificada(ajeno, otro, '2026-12-02T12:00:00.000Z');

  conMiniatura = propiasEst1[0] ?? '';
  await e.admin
    .updateTable('archivo')
    .set({
      ruta_miniatura: `proyectos/${o.esc.proyectoId}/archivos/${conMiniatura}/miniatura.jpg`,
      ruta_preview: `proyectos/${o.esc.proyectoId}/archivos/${conMiniatura}/preview/x.jpg`,
    })
    .where('id', '=', conMiniatura)
    .execute();
});
afterAll(async () => {
  await e.cerrar();
});

describe('galería: paginación por cursor', () => {
  it('recorre todas las fotos sin repetir ni saltar, en orden (capturado_en desc, id desc)', async () => {
    const completa = await galeria(o.coordinacion.token, '?limite=100');
    expect(completa.cuerpo.siguiente).toBeNull();
    const esperadas = completa.cuerpo.fotos;
    expect(esperadas).toHaveLength(8);
    const orden = [...esperadas].sort((a, b) =>
      a.capturado_en === b.capturado_en
        ? b.id.localeCompare(a.id)
        : b.capturado_en.localeCompare(a.capturado_en),
    );
    expect(esperadas.map((f) => f.id)).toEqual(orden.map((f) => f.id));

    const { ids, paginas } = await todas(o.coordinacion.token, 2);
    expect(paginas).toBe(4);
    expect(ids).toEqual(esperadas.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('el cursor respeta los filtros y el alcance del especialista', async () => {
    const { ids } = await todas(duenio.token, 3);
    expect(new Set(ids)).toEqual(new Set([...propiasEst1, ...propiasEst2]));
    const est1 = await todas(o.coordinacion.token, 2, `&estacion=${o.esc.estacionId}`);
    expect(new Set(est1.ids)).toEqual(new Set([...propiasEst1, fotoB]));
    // Otro especialista de la misma brigada no ve fotos ajenas en ninguna página.
    const c = await galeria(companero.token, '?limite=2');
    expect(c.cuerpo).toEqual(expect.objectContaining({ fotos: [], siguiente: null }));
  });

  it('cursor inválido: 400 en problem+json', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/galeria?cursor=no-es-un-cursor`,
    );
    expect(r.statusCode).toBe(400);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect((await galeria(o.coordinacion.token, '?limite=0')).status).toBe(400);
  });

  it('negativas: otro proyecto, otra brigada y el Administrador técnico', async () => {
    expect((await galeria(ajeno.token)).status).toBe(404);
    expect((await galeria(o.jefeB.token, `?brigada=${o.esc.brigadaId}`)).status).toBe(404);
    expect((await galeria(o.jefeB.token)).cuerpo.fotos.map((f) => f.id)).toEqual([fotoB]);
    expect((await galeria(o.admin.token)).status).toBe(404);
  });
});

describe('galería: miniatura firmada y vista inline', () => {
  it('la página trae la URL firmada de la miniatura, inline y image/jpeg; sin miniatura, null', async () => {
    const r = await galeria(o.coordinacion.token, '?limite=100');
    const f = r.cuerpo.fotos.find((x) => x.id === conMiniatura);
    expect(f?.miniatura_url).toEqual(expect.stringContaining('miniatura.jpg'));
    expect(f?.miniatura_url).toEqual(
      expect.stringContaining('response-content-disposition=inline'),
    );
    expect(f?.miniatura_url).toEqual(expect.stringContaining('response-content-type=image%2Fjpeg'));
    expect(r.cuerpo.fotos.filter((x) => x.miniatura_url === null)).toHaveLength(7);
  });

  it('la vista de 2 048 px se firma inline con image/jpeg y vuelve a autorizar', async () => {
    const ok = await pedir(e, o.coordinacion.token, 'GET', `/archivos/${conMiniatura}/url`);
    expect(ok.statusCode).toBe(200);
    const url = ok.json<{ url: string }>().url;
    expect(url).toContain('response-content-disposition=inline');
    expect(url).not.toContain('attachment');
    expect(url).toContain('response-content-type=image%2Fjpeg');
    expect(
      (await pedir(e, companero.token, 'GET', `/archivos/${conMiniatura}/url`)).statusCode,
    ).toBe(404);
    expect((await pedir(e, ajeno.token, 'GET', `/archivos/${conMiniatura}/url`)).statusCode).toBe(
      404,
    );
  });
});

describe('galería: agregado por estación para el mini mapa', () => {
  it('Coordinación ve todas las estaciones con fotos y su número, con coordenadas', async () => {
    const r = await estaciones(o.coordinacion.token);
    expect(r.status).toBe(200);
    expect(cuentas(r.cuerpo.estaciones)).toEqual({ [o.esc.estacionId]: 6, [estacion2]: 2 });
    const e2 = r.cuerpo.estaciones.find((x) => x.estacion_id === estacion2);
    expect(e2).toEqual(expect.objectContaining({ codigo: 'EST-GAL-2' }));
    expect(e2?.lat).toBeCloseTo(-11.5);
    expect(e2?.lon).toBeCloseTo(-76.5);
  });

  it('respeta los filtros activos (método, día, selección, brigada)', async () => {
    const t = o.coordinacion.token;
    expect(cuentas((await estaciones(t, `?metodo=${o.esc.eventoId}`)).cuerpo.estaciones)).toEqual({
      [o.esc.estacionId]: 1,
      [estacion2]: 2,
    });
    expect(cuentas((await estaciones(t, '?fecha=2026-12-03')).cuerpo.estaciones)).toEqual({
      [o.esc.estacionId]: 1,
    });
    expect((await estaciones(t, '?seleccion=candidatas')).cuerpo.estaciones).toEqual([]);
    expect(cuentas((await estaciones(t, `?brigada=${o.esc.brigadaB}`)).cuerpo.estaciones)).toEqual({
      [o.esc.estacionId]: 1,
    });
  });

  it('el especialista solo cuenta lo suyo; el compañero de brigada, nada', async () => {
    expect(cuentas((await estaciones(duenio.token)).cuerpo.estaciones)).toEqual({
      [o.esc.estacionId]: 5,
      [estacion2]: 2,
    });
    expect((await estaciones(companero.token)).cuerpo.estaciones).toEqual([]);
  });

  it('negativas: otra brigada, otro proyecto y el Administrador técnico', async () => {
    expect(cuentas((await estaciones(o.jefeB.token)).cuerpo.estaciones)).toEqual({
      [o.esc.estacionId]: 1,
    });
    expect((await estaciones(o.jefeB.token, `?brigada=${o.esc.brigadaId}`)).status).toBe(404);
    expect((await estaciones(ajeno.token)).status).toBe(404);
    expect((await estaciones(o.admin.token)).status).toBe(404);
    expect((await estaciones(o.coordinacion.token, '', generarId())).status).toBe(404);
  });
});
