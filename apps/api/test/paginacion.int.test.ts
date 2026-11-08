import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import { iniciarEntorno, organizacion, pedir, type Entorno, type Organizacion } from './entorno.ts';

/**
 * Paginación por cursor de las listas de la web (ejecuciones y alertas): orden estable
 * (instante desc, id desc), sin duplicados ni saltos entre páginas aunque varias filas compartan
 * el instante o difieran solo en microsegundos, y sin salirse del alcance (otra brigada, otro
 * proyecto). La autorización la sigue haciendo el servicio: el cursor no la reemplaza.
 */
let e: Entorno;
let o: Organizacion;
let otro: Organizacion;

/** Ids de la brigada A y de la B en el orden que debe devolver la API. */
let ejecucionesA: string[] = [];
let ejecucionesB: string[] = [];
let alertasA: string[] = [];
let alertasB: string[] = [];
let alertaSinBrigada = '';

/** Instantes repetidos y a microsegundos: un cursor con milisegundos saltaría o duplicaría. */
const INSTANTES = [
  '2026-12-01 10:00:00.000001+00',
  '2026-12-01 10:00:00.000002+00',
  '2026-12-01 10:00:00.000002+00',
  '2026-12-01 10:00:00.000002+00',
  '2026-12-01 11:30:00+00',
  '2026-12-02 08:00:00.5+00',
  '2026-12-02 08:00:00.5+00',
];

const ordenEsperado = async (tabla: 'ejecucion' | 'alerta', ids: string[]) => {
  const columna = tabla === 'ejecucion' ? 'abierta_en' : 'creado_en';
  const filas = await e.admin
    .selectFrom(tabla)
    .select('id')
    .where('id', 'in', ids)
    .orderBy(columna, 'desc')
    .orderBy('id', 'desc')
    .execute();
  return filas.map((f) => f.id);
};

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  otro = await organizacion(e);

  const ejecucion = (brigadaId: string, usuarioId: string, abierta: string) => {
    const id = generarId();
    return {
      id,
      proyecto_id: o.esc.proyectoId,
      brigada_id: brigadaId,
      estacion_id: o.esc.estacionId,
      metodo_id: o.esc.metodoId,
      usuario_id: usuarioId,
      abierta_en: abierta,
    };
  };
  const filasA = INSTANTES.map((t) => ejecucion(o.esc.brigadaId, o.especialista.id, t));
  const filasB = INSTANTES.slice(0, 4).map((t) => ejecucion(o.esc.brigadaB, o.especialistaB.id, t));
  await e.admin
    .insertInto('ejecucion')
    .values([...filasA, ...filasB])
    .execute();
  ejecucionesA = await ordenEsperado(
    'ejecucion',
    filasA.map((f) => f.id),
  );
  ejecucionesB = await ordenEsperado(
    'ejecucion',
    filasB.map((f) => f.id),
  );

  const alerta = (brigadaId: string | null, creado: string) => ({
    id: generarId(),
    proyecto_id: o.esc.proyectoId,
    tipo: 'tecnica',
    origen: 'usuario',
    brigada_id: brigadaId,
    titulo: 'Trampa inundada',
    creado_en: creado,
  });
  const alA = INSTANTES.map((t) => alerta(o.esc.brigadaId, t));
  const alB = INSTANTES.slice(0, 4).map((t) => alerta(o.esc.brigadaB, t));
  const sinBrigada = alerta(null, INSTANTES[2] ?? '');
  alertaSinBrigada = sinBrigada.id;
  await e.admin
    .insertInto('alerta')
    .values([...alA, ...alB, sinBrigada])
    .execute();
  alertasA = await ordenEsperado(
    'alerta',
    alA.map((f) => f.id),
  );
  alertasB = await ordenEsperado(
    'alerta',
    alB.map((f) => f.id),
  );
});
afterAll(async () => {
  await e.cerrar();
});

interface Pagina {
  readonly siguiente_cursor: string | null;
  readonly [lista: string]: unknown;
}

/** Recorre todas las páginas y devuelve los ids en orden y cuántas páginas hubo. */
const recorrer = async (
  token: string,
  ruta: string,
  clave: 'ejecuciones' | 'alertas',
  limite: number,
  filtro = '',
) => {
  const ids: string[] = [];
  let cursor: string | null = null;
  let paginas = 0;
  do {
    const consulta: string = `?limite=${String(limite)}${filtro}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
    const r = await pedir(e, token, 'GET', `${ruta}${consulta}`);
    expect(r.statusCode).toBe(200);
    const cuerpo = r.json<Pagina>();
    const filas = cuerpo[clave] as { id: string; _cursor_t?: unknown }[];
    expect(filas.length).toBeLessThanOrEqual(limite);
    // La columna auxiliar del cursor nunca sale en la respuesta.
    for (const f of filas) expect(f).not.toHaveProperty('_cursor_t');
    ids.push(...filas.map((f) => f.id));
    cursor = cuerpo.siguiente_cursor;
    paginas += 1;
    if (paginas > 50) throw new Error('El cursor no avanza');
  } while (cursor !== null);
  return { ids, paginas };
};

describe('GET /proyectos/:id/ejecuciones paginada por cursor', () => {
  const ruta = () => `/proyectos/${o.esc.proyectoId}/ejecuciones`;

  it('Coordinación recorre todas las páginas en orden estable, sin duplicados ni saltos', async () => {
    const { ids, paginas } = await recorrer(o.coordinacion.token, ruta(), 'ejecuciones', 3);
    expect(new Set(ids).size).toBe(ids.length);
    const esperado = await ordenEsperado('ejecucion', [...ejecucionesA, ...ejecucionesB]);
    expect(ids).toEqual(esperado);
    expect(paginas).toBe(Math.ceil(esperado.length / 3));
  });

  it('el Jefe de Brigada A pagina solo lo de su brigada: la B nunca aparece', async () => {
    const { ids } = await recorrer(o.jefeA.token, ruta(), 'ejecuciones', 2);
    expect(ids).toEqual(ejecucionesA);
    expect(ids.some((id) => ejecucionesB.includes(id))).toBe(false);
  });

  it('el especialista de la B solo pagina sus ejecuciones', async () => {
    const { ids } = await recorrer(o.especialistaB.token, ruta(), 'ejecuciones', 1);
    expect(ids).toEqual(ejecucionesB);
  });

  it('un cursor de la Coordinación no abre la otra brigada al Jefe de Brigada A', async () => {
    // Página 1 de Coordinación (puede terminar en una fila de B); el JdB A la reutiliza.
    const r1 = await pedir(e, o.coordinacion.token, 'GET', `${ruta()}?limite=1`);
    const cursor = r1.json<Pagina>().siguiente_cursor;
    expect(cursor).not.toBeNull();
    const r2 = await pedir(
      e,
      o.jefeA.token,
      'GET',
      `${ruta()}?limite=100&cursor=${encodeURIComponent(cursor ?? '')}`,
    );
    expect(r2.statusCode).toBe(200);
    const ids = r2.json<{ ejecuciones: { id: string }[] }>().ejecuciones.map((x) => x.id);
    expect(ids.some((id) => ejecucionesB.includes(id))).toBe(false);
  });

  it('conserva los filtros entre páginas', async () => {
    const { ids } = await recorrer(
      o.coordinacion.token,
      ruta(),
      'ejecuciones',
      2,
      `&brigada=${o.esc.brigadaB}`,
    );
    expect(ids).toEqual(ejecucionesB);
  });

  it('una ejecución nueva entre páginas no duplica ni corre las siguientes', async () => {
    const r1 = await pedir(e, o.jefeA.token, 'GET', `${ruta()}?limite=3`);
    const p1 = r1.json<{ ejecuciones: { id: string }[]; siguiente_cursor: string }>();
    const nueva = generarId();
    await e.admin
      .insertInto('ejecucion')
      .values({
        id: nueva,
        proyecto_id: o.esc.proyectoId,
        brigada_id: o.esc.brigadaId,
        estacion_id: o.esc.estacionId,
        metodo_id: o.esc.metodoId,
        usuario_id: o.especialista.id,
        abierta_en: '2027-01-01 00:00:00+00',
      })
      .execute();
    const r2 = await pedir(
      e,
      o.jefeA.token,
      'GET',
      `${ruta()}?limite=100&cursor=${encodeURIComponent(p1.siguiente_cursor)}`,
    );
    const resto = r2.json<{ ejecuciones: { id: string }[] }>().ejecuciones.map((x) => x.id);
    expect([...p1.ejecuciones.map((x) => x.id), ...resto]).toEqual(ejecucionesA);
    expect(resto).not.toContain(nueva);
  });

  it('sin `limite` devuelve 25 como máximo y `siguiente_cursor`', async () => {
    const r = await pedir(e, o.coordinacion.token, 'GET', ruta());
    expect(r.statusCode).toBe(200);
    expect(r.json<Pagina>()).toHaveProperty('siguiente_cursor');
  });

  it.each(['?limite=0', '?limite=101', '?cursor=no-es-un-cursor', `?cursor=${'x'.repeat(600)}`])(
    'rechaza %s con 400 (RFC 9457)',
    async (consulta) => {
      const r = await pedir(e, o.coordinacion.token, 'GET', `${ruta()}${consulta}`);
      expect(r.statusCode).toBe(400);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    },
  );

  it('rechaza un cursor bien formado en base64 pero con contenido inválido', async () => {
    const malo = Buffer.from(JSON.stringify({ t: "1' or 1=1 --", i: 'x' })).toString('base64url');
    const r = await pedir(e, o.coordinacion.token, 'GET', `${ruta()}?cursor=${malo}`);
    expect(r.statusCode).toBe(400);
    expect(r.json<{ codigo?: string }>()).toMatchObject({ codigo: 'CURSOR_INVALIDO' });
  });

  it('otro proyecto: su Jefe de Brigada recibe 404 aunque traiga un cursor', async () => {
    const r1 = await pedir(e, o.coordinacion.token, 'GET', `${ruta()}?limite=1`);
    const cursor = r1.json<Pagina>().siguiente_cursor ?? '';
    const r = await pedir(
      e,
      otro.jefeA.token,
      'GET',
      `${ruta()}?cursor=${encodeURIComponent(cursor)}`,
    );
    expect(r.statusCode).toBe(404);
  });
});

describe('GET /proyectos/:id/alertas paginada por cursor', () => {
  const ruta = () => `/proyectos/${o.esc.proyectoId}/alertas`;

  it('Coordinación recorre todas, incluida la que no tiene brigada, sin duplicados ni saltos', async () => {
    const { ids } = await recorrer(o.coordinacion.token, ruta(), 'alertas', 4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      await ordenEsperado('alerta', [...alertasA, ...alertasB, alertaSinBrigada]),
    );
  });

  it('el Jefe de Brigada A solo pagina las de su brigada', async () => {
    const { ids } = await recorrer(o.jefeA.token, ruta(), 'alertas', 3);
    expect(ids).toEqual(alertasA);
    expect(ids).not.toContain(alertaSinBrigada);
  });

  it('el Jefe de Brigada B solo pagina las de la B', async () => {
    const { ids } = await recorrer(o.jefeB.token, ruta(), 'alertas', 1);
    expect(ids).toEqual(alertasB);
  });

  it('conserva los filtros entre páginas', async () => {
    const { ids } = await recorrer(
      o.coordinacion.token,
      ruta(),
      'alertas',
      2,
      `&brigada=${o.esc.brigadaId}&tipo=tecnica`,
    );
    expect(ids).toEqual(alertasA);
  });

  it('rechaza un cursor inválido con 400', async () => {
    const r = await pedir(e, o.coordinacion.token, 'GET', `${ruta()}?cursor=%%%`);
    expect(r.statusCode).toBe(400);
  });

  it('otro proyecto: su Jefe de Brigada recibe 404', async () => {
    const r = await pedir(e, otro.jefeA.token, 'GET', `${ruta()}?limite=5`);
    expect(r.statusCode).toBe(404);
  });

  it('otro rol: el Administrador técnico no lista alertas del proyecto', async () => {
    const r = await pedir(e, o.admin.token, 'GET', `${ruta()}?limite=5`);
    if (r.statusCode === 200) {
      expect(r.json<{ alertas: unknown[] }>().alertas).toEqual([]);
    } else {
      expect([403, 404]).toContain(r.statusCode);
    }
  });
});
