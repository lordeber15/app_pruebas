import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { empaquetarSinCompresion } from '../src/plataforma/xlsx.ts';
import {
  conToken,
  enCampo,
  iniciarEntorno,
  nuevoEscenario,
  organizacion,
  pedir,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

/**
 * Polígonos del proyecto por KMZ (decisión del usuario, 2026-11-09; RF-W02, RF-M05, P-06):
 * carga, asignación a muchas estaciones, alerta técnica si una estación queda fuera y entrega al
 * celular en el paquete de campo. Con pruebas negativas por rol, alcance y contenido.
 */

let e: Entorno;
let o: Organizacion;

/** La estación del escenario está en (-77.03, -12.04). */
const anillo = (o: number, s: number, e2: number, n: number) =>
  `${String(o)},${String(s)},0 ${String(e2)},${String(s)},0 ${String(e2)},${String(n)},0 ${String(o)},${String(n)},0 ${String(o)},${String(s)},0`;

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name><![CDATA[Ámbito A & norte]]></name>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>${anillo(-77.05, -12.06, -77.01, -12.02)}</coordinates></LinearRing></outerBoundaryIs></Polygon>
  </Placemark>
  <Placemark><name>Ámbito B</name>
    <MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>${anillo(-76, -11, -75.9, -10.9)}</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>
  </Placemark>
  <Placemark><name>Campamento</name><Point><coordinates>-77.03,-12.04,0</coordinates></Point></Placemark>
</Document></kml>`;

const KMZ = empaquetarSinCompresion([{ nombre: 'doc.kml', datos: Buffer.from(KML, 'utf8') }]);

const subir = (token: string, proyecto: string, datos: Buffer, ruta = 'capas?asignar=dentro') =>
  e.app.inject({
    method: 'POST',
    url: `/api/v1/proyectos/${proyecto}/${ruta}`,
    headers: {
      ...conToken(token),
      'content-type': 'application/octet-stream',
      'x-nombre-archivo': encodeURIComponent('ámbitos.kmz'),
    },
    payload: datos,
  });

interface Poligono {
  id: string;
  nombre: string;
  estaciones: number;
  fuera: number;
}

let poligonoA: string;
let poligonoB: string;

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
});
afterAll(async () => {
  await e.cerrar();
});

describe('Carga de KMZ (2026-11-09)', () => {
  it('la vista previa lee los polígonos, dice qué estaciones caen dentro e informa lo ignorado', async () => {
    const r = await subir(o.coordinacion.token, o.esc.proyectoId, KMZ, 'capas/vista-previa');
    expect(r.statusCode).toBe(200);
    const v = r.json<{
      poligonos: { nombre: string; estaciones_dentro: { id: string }[] }[];
      ignorados: { nombre: string }[];
    }>();
    expect(v.poligonos.map((p) => p.nombre)).toEqual(['Ámbito A & norte', 'Ámbito B']);
    expect(v.poligonos[0]?.estaciones_dentro.map((x) => x.id)).toEqual([o.esc.estacionId]);
    expect(v.poligonos[1]?.estaciones_dentro).toEqual([]);
    expect(v.ignorados.map((x) => x.nombre)).toEqual(['Campamento']);
    // La vista previa no guarda nada.
    const capas = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/capas`,
    );
    expect(capas.json()).toEqual([]);
  });

  it('cargar con «asignar dentro» guarda la capa y asigna la estación que cae dentro', async () => {
    const r = await subir(o.jefeProyecto.token, o.esc.proyectoId, KMZ);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ poligonos: 2, estaciones_asignadas: 1 });
    const pol = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${o.esc.proyectoId}/poligonos`)
    ).json<Poligono[]>();
    expect(pol.map((p) => [p.nombre, p.estaciones, p.fuera])).toEqual([
      ['Ámbito A & norte', 1, 0],
      ['Ámbito B', 0, 0],
    ]);
    poligonoA = pol[0]?.id ?? '';
    poligonoB = pol[1]?.id ?? '';
    const est = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/estaciones/poligonos`,
    );
    expect(est.json()).toEqual([
      expect.objectContaining({
        estacion_id: o.esc.estacionId,
        poligono_id: poligonoA,
        dentro: true,
      }),
    ]);
  });

  it('un archivo que no es KMZ/KML, o un KML con DOCTYPE, se rechaza por contenido (415)', async () => {
    const texto = await subir(o.coordinacion.token, o.esc.proyectoId, Buffer.from('hola'));
    expect(texto.statusCode).toBe(415);
    const doctype = await subir(
      o.coordinacion.token,
      o.esc.proyectoId,
      Buffer.from(`<!DOCTYPE x [<!ENTITY a "b">]>${KML}`),
    );
    expect(doctype.statusCode).toBe(415);
  });

  it('negativos: especialista, Jefe de Brigada y Admin no cargan (403)', async () => {
    for (const p of [o.especialista, o.jefeA, o.admin]) {
      expect((await subir(p.token, o.esc.proyectoId, KMZ)).statusCode).toBe(403);
    }
  });
});

describe('Asignación y alerta de estación fuera del polígono', () => {
  it('asignar una estación a un polígono que no la contiene genera una alerta técnica, una sola vez', async () => {
    const asignar = () =>
      pedir(e, o.coordinacion.token, 'POST', `/proyectos/${o.esc.proyectoId}/estaciones/poligono`, {
        estacion_ids: [o.esc.estacionId],
        poligono_id: poligonoB,
      });
    const r = await asignar();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ asignadas: 1, alertas_nuevas: 1 });
    expect(r.json<{ fuera: string[] }>().fuera).toHaveLength(1);
    const alertas = await e.admin
      .selectFrom('alerta')
      .select(['tipo', 'origen', 'estacion_id', 'brigada_id', 'titulo'])
      .where('proyecto_id', '=', o.esc.proyectoId)
      .where('clave_dedup', 'like', 'poligono:%')
      .execute();
    expect(alertas).toEqual([
      expect.objectContaining({
        tipo: 'tecnica',
        origen: 'sistema',
        estacion_id: o.esc.estacionId,
        brigada_id: null,
      }),
    ]);
    expect(alertas[0]?.titulo).toContain('Ámbito B');
    // Misma estación, mismo lugar y mismo polígono: no se repite la alerta.
    expect((await asignar()).json()).toMatchObject({ alertas_nuevas: 0 });
    const pol = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${o.esc.proyectoId}/poligonos`)
    ).json<Poligono[]>();
    expect(pol.find((p) => p.id === poligonoB)).toMatchObject({ estaciones: 1, fuera: 1 });
  });

  it('el paquete de campo lleva el polígono y marca la estación fuera', async () => {
    const yo = await enCampo(e, o.esc.brigadaId);
    const r = await e.app.inject({
      method: 'GET',
      url: '/api/v1/paquete/campo',
      headers: conToken(yo.token),
    });
    expect(r.statusCode).toBe(200);
    const p = r.json<{
      estaciones: { id: string; poligono_id: string | null; dentro_poligono: boolean | null }[];
      poligonos: { id: string; geometria: { type: string } }[];
    }>();
    expect(p.estaciones.find((x) => x.id === o.esc.estacionId)).toMatchObject({
      poligono_id: poligonoB,
      dentro_poligono: false,
    });
    expect(p.poligonos).toHaveLength(1);
    expect(p.poligonos[0]).toMatchObject({ id: poligonoB, geometria: { type: 'MultiPolygon' } });
  });

  it('quitar el polígono (null) deja la estación sin polígono y sin nueva alerta', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${o.esc.proyectoId}/estaciones/poligono`,
      { estacion_ids: [o.esc.estacionId], poligono_id: null },
    );
    expect(r.json()).toMatchObject({ asignadas: 1, fuera: [], alertas_nuevas: 0 });
  });

  it('negativos: otro rol no asigna (403); polígono o estación de otro proyecto, 404/422', async () => {
    const cuerpo = { estacion_ids: [o.esc.estacionId], poligono_id: poligonoA };
    for (const p of [o.especialista, o.jefeA, o.supervisorA, o.admin]) {
      const r = await pedir(
        e,
        p.token,
        'POST',
        `/proyectos/${o.esc.proyectoId}/estaciones/poligono`,
        cuerpo,
      );
      expect(r.statusCode).toBe(403);
    }
    const otro = await nuevoEscenario(e);
    const polAjeno = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${otro.proyectoId}/estaciones/poligono`,
      { estacion_ids: [otro.estacionId], poligono_id: poligonoA },
    );
    expect(polAjeno.statusCode).toBe(404);
    const estacionAjena = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${o.esc.proyectoId}/estaciones/poligono`,
      { estacion_ids: [otro.estacionId], poligono_id: poligonoA },
    );
    expect(estacionAjena.statusCode).toBe(422);
  });

  it('alcance de lectura: miembros de la brigada ven los polígonos; Admin y otro proyecto no (404)', async () => {
    const ruta = `/proyectos/${o.esc.proyectoId}/poligonos`;
    expect((await pedir(e, o.especialista.token, 'GET', ruta)).statusCode).toBe(200);
    expect((await pedir(e, o.admin.token, 'GET', ruta)).statusCode).toBe(404);
    const otro = await nuevoEscenario(e);
    expect(
      (await pedir(e, o.especialista.token, 'GET', `/proyectos/${otro.proyectoId}/poligonos`))
        .statusCode,
    ).toBe(404);
  });
});
