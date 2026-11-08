import { bboxDePuntos, type DescargaPaqueteMapa, type PaqueteMapa } from '@campo/core';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  enCampo,
  iniciarEntorno,
  nuevoEscenario,
  organizacion,
  pedir,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

/**
 * Paquetes de mapa sin conexión (RF-M05, CA-08, V-10): alcance por rol y brigada, área máxima,
 * áreas automáticas de las brigadas al publicar o cambiar el cronograma y confirmación de
 * descarga solo con el dispositivo de la sesión.
 */
let e: Entorno;
let o: Organizacion;
/** Estación de la brigada B y otra lejana que se agrega después a la A. */
let estacionB: string;
let estacionLejana: string;

const LIMA = { lat: -12.04, lon: -77.03 };
const HUANCAYO = { lat: -12.07, lon: -75.21 };
const ICA = { lat: -14.07, lon: -75.73 };

const nuevaEstacion = async (proyectoId: string, codigo: string, p: typeof LIMA) => {
  const id = generarId();
  await e.admin
    .insertInto('estacion')
    .values({
      id,
      proyecto_id: proyectoId,
      codigo,
      geom: sql<string>`ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)`,
    })
    .execute();
  return id;
};

const lista = async (token: string, proyectoId = o.esc.proyectoId) => {
  const r = await pedir(e, token, 'GET', `/proyectos/${proyectoId}/mapas`);
  return { status: r.statusCode, paquetes: r.json<{ paquetes?: PaqueteMapa[] }>().paquetes ?? [] };
};

const AREA_CHICA = [-77.1, -12.1, -77.0, -12.0] as const;

const crear = (token: string, cuerpo: object, proyectoId = o.esc.proyectoId) =>
  pedir(e, token, 'POST', `/proyectos/${proyectoId}/mapas`, cuerpo);

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  estacionB = await nuevaEstacion(o.esc.proyectoId, 'EST-B', HUANCAYO);
  estacionLejana = await nuevaEstacion(o.esc.proyectoId, 'EST-ICA', ICA);
  // El escenario pone su estación en Lima.
});
afterAll(async () => {
  await e.cerrar();
});

describe('RF-M05 paquetes de brigada', () => {
  it('RF-M05: al publicar el cronograma base se crea un paquete por brigada con sus estaciones + 5 km', async () => {
    const ruta = `/proyectos/${o.esc.proyectoId}/cronograma/borrador`;
    for (const [brigada, estacion] of [
      [o.esc.brigadaId, o.esc.estacionId],
      [o.esc.brigadaB, estacionB],
    ] as const) {
      const r = await pedir(e, o.coordinacion.token, 'POST', ruta, {
        brigada_id: brigada,
        fecha: '2026-12-01',
        tipo_actividad: 'estacion',
        estacion_id: estacion,
      });
      expect(r.statusCode).toBe(201);
    }
    expect((await pedir(e, o.coordinacion.token, 'POST', `${ruta}/publicar`)).statusCode).toBe(201);

    const { paquetes } = await lista(o.coordinacion.token);
    const deBrigada = paquetes.filter((p) => p.origen === 'brigada');
    expect(deBrigada).toHaveLength(2);
    const a = deBrigada.find((p) => p.brigada_id === o.esc.brigadaId);
    expect(a).toMatchObject({ estado: 'pendiente', version: 1, zoom_max: 15, descargas: 0 });
    expect(a?.bbox).toEqual(bboxDePuntos([LIMA]));
    expect(deBrigada.find((p) => p.brigada_id === o.esc.brigadaB)?.bbox).toEqual(
      bboxDePuntos([HUANCAYO]),
    );
  });

  it('RF-M05: regenerar las de brigada solo Coordinación y JdP; sin cambios no sube la versión', async () => {
    const ruta = `/proyectos/${o.esc.proyectoId}/mapas/brigadas`;
    for (const p of [o.especialista, o.jefeA, o.supervisorA, o.admin]) {
      expect((await pedir(e, p.token, 'POST', ruta, {})).statusCode).toBe(403);
    }
    expect(
      (await pedir(e, o.coordinacion.token, 'POST', `/proyectos/${generarId()}/mapas/brigadas`, {}))
        .statusCode,
    ).toBe(404);
    const igual = await pedir(e, o.jefeProyecto.token, 'POST', ruta, {});
    expect(igual.statusCode).toBe(200);
    expect(igual.json<{ paquetes: PaqueteMapa[] }>().paquetes.map((p) => p.version)).toEqual([
      1, 1,
    ]);
    const forzado = await pedir(e, o.coordinacion.token, 'POST', ruta, { forzar: true });
    expect(forzado.json<{ paquetes: PaqueteMapa[] }>().paquetes.map((p) => p.version)).toEqual([
      2, 2,
    ]);
  });

  it('RF-M05: al aplicar un cambio del cronograma que amplía la zona, el paquete de la brigada se regenera', async () => {
    const r = await pedir(
      e,
      o.jefeProyecto.token,
      'POST',
      `/proyectos/${o.esc.proyectoId}/cronograma/aplicar`,
      {
        motivo: 'Se suma una estación lejana',
        cambios: [
          {
            tipo: 'agregar',
            item: {
              id: generarId(),
              brigada_id: o.esc.brigadaId,
              fecha: '2026-12-02',
              tipo_actividad: 'estacion',
              estacion_id: estacionLejana,
              detalle: null,
              actividad_especial: null,
            },
          },
        ],
      },
    );
    expect(r.statusCode).toBe(201);
    const { paquetes } = await lista(o.coordinacion.token);
    const a = paquetes.find((p) => p.origen === 'brigada' && p.brigada_id === o.esc.brigadaId);
    const b = paquetes.find((p) => p.origen === 'brigada' && p.brigada_id === o.esc.brigadaB);
    expect(a).toMatchObject({ version: 3, estado: 'pendiente' });
    expect(a?.bbox).toEqual(bboxDePuntos([LIMA, ICA]));
    expect(b?.version).toBe(2);
  });
});

describe('RF-M05 alcance y áreas de usuario', () => {
  it('RF-M05: el personal de campo solo ve los paquetes de sus brigadas; otro proyecto y el Administrador, 404', async () => {
    const delA = await lista(o.especialista.token);
    expect(delA.status).toBe(200);
    expect(delA.paquetes.length).toBeGreaterThan(0);
    expect(delA.paquetes.every((p) => p.brigada_id === o.esc.brigadaId)).toBe(true);
    const delB = await lista(o.especialistaB.token);
    expect(delB.paquetes.every((p) => p.brigada_id === o.esc.brigadaB)).toBe(true);
    expect((await lista(o.admin.token)).status).toBe(404);
    const otro = await nuevoEscenario(e);
    expect((await lista(o.especialista.token, otro.proyectoId)).status).toBe(404);
    expect((await lista(o.coordinacion.token, otro.proyectoId)).status).toBe(200);
  });

  it('RF-M05: un especialista marca un área: queda de su brigada, pendiente y avisa al worker', async () => {
    const oyente = new pg.Client({ connectionString: e.base.url('app_rw') });
    await oyente.connect();
    const avisos: string[] = [];
    oyente.on('notification', (n) => {
      if (n.channel === 'paquete_mapa' && n.payload !== undefined) avisos.push(n.payload);
    });
    await oyente.query('LISTEN paquete_mapa');
    try {
      const r = await crear(o.especialista.token, { nombre: 'Quebrada', bbox: AREA_CHICA });
      expect(r.statusCode).toBe(201);
      const p = r.json<PaqueteMapa>();
      expect(p).toMatchObject({
        origen: 'usuario',
        brigada_id: o.esc.brigadaId,
        estado: 'pendiente',
        zoom_max: 15,
        version: 1,
        tamano: null,
        descargas: 0,
        solicitado_por_nombre: 'Usuario Sintético',
      });
      for (let i = 0; i < 50 && !avisos.includes(p.id); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(avisos).toContain(p.id);
    } finally {
      await oyente.end();
    }
  });

  it('RF-M05: otra brigada u otro proyecto no; Coordinación con brigada ajena tampoco', async () => {
    expect(
      (
        await crear(o.especialista.token, {
          nombre: 'X',
          bbox: AREA_CHICA,
          brigada_id: o.esc.brigadaB,
        })
      ).statusCode,
    ).toBe(404);
    const otro = await nuevoEscenario(e);
    expect(
      (await crear(o.especialista.token, { nombre: 'X', bbox: AREA_CHICA }, otro.proyectoId))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await crear(o.coordinacion.token, {
          nombre: 'X',
          bbox: AREA_CHICA,
          brigada_id: otro.brigadaId,
        })
      ).statusCode,
    ).toBe(404);
    expect((await crear(o.admin.token, { nombre: 'X', bbox: AREA_CHICA })).statusCode).toBe(404);
    // Coordinación puede marcar un área sin brigada.
    const libre = await crear(o.coordinacion.token, { nombre: 'Zona general', bbox: AREA_CHICA });
    expect(libre.statusCode).toBe(201);
    expect(libre.json<PaqueteMapa>().brigada_id).toBeNull();
    // Y el personal de campo no la ve.
    const { paquetes } = await lista(o.especialista.token);
    expect(paquetes.some((p) => p.id === libre.json<PaqueteMapa>().id)).toBe(false);
  });

  it('RF-M05 V-10: un área de más de 80 km por lado se rechaza con un mensaje claro; un área invertida, 400', async () => {
    const r = await crear(o.especialista.token, {
      nombre: 'Todo el valle',
      bbox: [-77.5, -12.5, -76.0, -11.5],
    });
    expect(r.statusCode).toBe(422);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.json<{ codigo: string; detail: string }>()).toMatchObject({ codigo: 'AREA_GRANDE' });
    expect(r.json<{ detail: string }>().detail).toContain('Marque un área más pequeña');
    expect(
      (
        await crear(o.especialista.token, {
          nombre: 'Al revés',
          bbox: [-77.0, -12.0, -77.1, -12.1],
        })
      ).statusCode,
    ).toBe(400);
  });

  it('RF-M05: máximo 10 áreas por usuario y proyecto (las que terminaron en error no cuentan)', async () => {
    const yo = o.supervisorA;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await crear(yo.token, { nombre: `Área ${String(i)}`, bbox: AREA_CHICA });
      expect(r.statusCode).toBe(201);
      ids.push(r.json<PaqueteMapa>().id);
    }
    const once = await crear(yo.token, { nombre: 'Once', bbox: AREA_CHICA });
    expect(once.statusCode).toBe(409);
    expect(once.json<{ codigo: string }>().codigo).toBe('LIMITE_PAQUETES');
    await e.admin
      .updateTable('paquete_mapa')
      .set({ estado: 'error', error: 'El área pesa 200 MB; el máximo es 150 MB.' })
      .where('id', '=', ids[0] ?? '')
      .execute();
    expect((await crear(yo.token, { nombre: 'Once', bbox: AREA_CHICA })).statusCode).toBe(201);
  });
});

describe('RF-M05 regenerar, descargar y confirmar', () => {
  let propio: PaqueteMapa;

  beforeAll(async () => {
    propio = (await crear(o.especialista.token, { nombre: 'Propia', bbox: AREA_CHICA })).json();
  });

  it('RF-M05: regenera quien la pidió o Coordinación/JdP; otro de la brigada 403, otra brigada 404', async () => {
    const ruta = `/mapas/${propio.id}/regenerar`;
    expect((await pedir(e, o.supervisorA.token, 'POST', ruta)).statusCode).toBe(403);
    expect((await pedir(e, o.especialistaB.token, 'POST', ruta)).statusCode).toBe(404);
    const r = await pedir(e, o.especialista.token, 'POST', ruta);
    expect(r.statusCode).toBe(200);
    expect(r.json<PaqueteMapa>()).toMatchObject({ version: 2, estado: 'pendiente' });
    expect((await pedir(e, o.coordinacion.token, 'POST', ruta)).json<PaqueteMapa>().version).toBe(
      3,
    );
    const deBrigada = (await lista(o.especialista.token)).paquetes.find(
      (p) => p.origen === 'brigada',
    );
    expect(
      (await pedir(e, o.especialista.token, 'POST', `/mapas/${deBrigada?.id ?? ''}/regenerar`))
        .statusCode,
    ).toBe(403);
    // Un paquete en error se puede reintentar (también el solicitante de campo).
    await e.admin
      .updateTable('paquete_mapa')
      .set({ estado: 'error', error: 'El área pesa 200 MB; el máximo es 150 MB.' })
      .where('id', '=', propio.id)
      .execute();
    const reintento = await pedir(e, o.especialista.token, 'POST', ruta);
    expect(reintento.statusCode).toBe(200);
    expect(reintento.json<PaqueteMapa>()).toMatchObject({
      version: 4,
      estado: 'pendiente',
      error: null,
    });
    propio = reintento.json();
  });

  it('RF-M05: la descarga exige el paquete listo y da una URL firmada ≤ 15 min', async () => {
    const ruta = `/mapas/${propio.id}/descarga`;
    const pendiente = await pedir(e, o.especialista.token, 'GET', ruta);
    expect(pendiente.statusCode).toBe(409);
    expect(pendiente.json<{ codigo: string }>().codigo).toBe('PAQUETE_NO_LISTO');
    await e.admin
      .updateTable('paquete_mapa')
      .set({
        estado: 'listo',
        ruta_objeto: `proyectos/${o.esc.proyectoId}/mapas/${propio.id}/${generarId()}.pmtiles`,
        tamano: 1_400_000,
        sha256: 'ab'.repeat(32),
        generado_en: new Date(),
      })
      .where('id', '=', propio.id)
      .execute();
    const antes = Date.now();
    const r = await pedir(e, o.supervisorA.token, 'GET', ruta);
    expect(r.statusCode).toBe(200);
    const d = r.json<DescargaPaqueteMapa>();
    expect(d.url).toMatch(/^http:\/\/almacen\.prueba\/archivos\/proyectos\/.+\.pmtiles\?/);
    expect(d).toMatchObject({
      tamano: 1_400_000,
      sha256: 'ab'.repeat(32),
      version: propio.version,
    });
    expect(new Date(d.expira_en).getTime() - antes).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    expect((await pedir(e, o.especialistaB.token, 'GET', ruta)).statusCode).toBe(404);
    expect((await pedir(e, o.admin.token, 'GET', ruta)).statusCode).toBe(404);
    expect((await pedir(e, o.coordinacion.token, 'GET', ruta)).statusCode).toBe(200);
  });

  it('RF-M05: confirmar la descarga usa el dispositivo de la sesión; sin dispositivo 400, otra brigada 404', async () => {
    const ruta = `/mapas/${propio.id}/descargado`;
    expect(
      (await pedir(e, o.especialista.token, 'POST', ruta, { version: propio.version })).statusCode,
    ).toBe(400);
    const celular = await enCampo(e, o.esc.brigadaId);
    const otroCelular = await enCampo(e, o.esc.brigadaB);
    expect(
      (await pedir(e, otroCelular.token, 'POST', ruta, { version: propio.version })).statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, celular.token, 'POST', ruta, { version: propio.version + 1 })).statusCode,
    ).toBe(400);
    for (let i = 0; i < 2; i++) {
      expect(
        (await pedir(e, celular.token, 'POST', ruta, { version: propio.version })).statusCode,
      ).toBe(204);
    }
    const filas = await e.admin
      .selectFrom('paquete_mapa_descarga')
      .selectAll()
      .where('paquete_id', '=', propio.id)
      .execute();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      dispositivo_id: celular.dispositivoId,
      usuario_id: celular.usuario.id,
    });
    const ver = async () =>
      (await lista(o.coordinacion.token)).paquetes.find((p) => p.id === propio.id)?.descargas;
    expect(await ver()).toBe(1);
    // Una versión nueva deja de contar las descargas de la anterior.
    await pedir(e, o.especialista.token, 'POST', `/mapas/${propio.id}/regenerar`);
    expect(await ver()).toBe(0);
  });
});
