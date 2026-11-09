import { ROLES, nivelPermiso, type Accion, type Rol } from '@campo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  cerrar,
  enCampo,
  foto,
  iniciarEntorno,
  lote,
  organizacion,
  pedir,
  sobre,
  type Entorno,
  type Organizacion,
  type Persona,
} from './entorno.ts';

/**
 * Prueba de la matriz de permisos (CLAUDE.md, Seguridad; ERS §2.3; SEG-01 y SEG-02).
 * Se genera desde MATRIZ_PERMISOS de core: para cada acción con endpoint web y cada rol, lo
 * permitido debe responder 2xx y lo no permitido 403/404. Las acciones de campo (descargar el
 * paquete, ejecutar métodos) exigen un dispositivo y se prueban en `campo.int` y `sync.int`.
 * Los casos horizontales (otro proyecto, otra brigada) van al final.
 */
let e: Entorno;
let o: Organizacion;

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
});
afterAll(async () => {
  await e.cerrar();
});

const personaDe = (rol: Rol): Persona =>
  ({
    especialista: o.especialista,
    supervisor_campo: o.supervisorA,
    jefe_brigada: o.jefeA,
    coordinacion: o.coordinacion,
    jefe_proyecto: o.jefeProyecto,
    admin: o.admin,
  })[rol];

/**
 * Foto ya verificada de un especialista nuevo de la brigada A (o de la B, como EVENTO, que no
 * tiene reserva).
 */
const fotoVerificada = async (brigada: 'A' | 'B' = 'A') => {
  const autor = await enCampo(e, brigada === 'A' ? o.esc.brigadaId : o.esc.brigadaB);
  const ejecucionId = generarId();
  const f = foto(ejecucionId, null);
  const metodo =
    brigada === 'A'
      ? o.esc
      : { reservaId: null, estacionId: o.esc.estacionId, metodoId: o.esc.eventoId };
  const r = await lote(e, autor.token, [abrir(ejecucionId, metodo), f]);
  expect(r.map((x) => x.estado)).toEqual(['aplicado', 'aplicado']);
  await e.admin
    .updateTable('archivo')
    .set({
      estado: 'preview_verificada',
      ruta_preview: `proyectos/x/archivos/${f.payload.archivo_id}/preview/p.jpg`,
    })
    .where('id', '=', f.payload.archivo_id)
    .execute();
  return f.payload.archivo_id;
};

/** Evento en revisión (RN-13): una unidad que llega con la ejecución ya cerrada. */
const eventoEnRevision = async () => {
  const autor = await enCampo(e, o.esc.brigadaId);
  const ejecucionId = generarId();
  const unidadId = generarId();
  const tardia = sobre(
    'unidad_guardada',
    { tipo: 'unidad', id: unidadId },
    {
      unidad_id: unidadId,
      ejecucion_id: ejecucionId,
      codigo: 'P-01',
      tipo_unidad: 'punto',
      orden: 0,
      estado: 'cerrada',
      geometria: { tipo: 'punto', punto: { lat: -12.04, lon: -77.03 } },
      inicio: null,
      fin: null,
      datos: {},
      registros: [],
      unidad_vinculada_id: null,
      parametros_confirmados: [],
    },
  );
  const r = await lote(e, autor.token, [
    abrir(ejecucionId, o.esc),
    cerrar(ejecucionId, []),
    tardia,
  ]);
  expect(r[2]).toMatchObject({ estado: 'en_revision', motivo: 'EJECUCION_CERRADA' });
  return tardia.id;
};

/** Cada caso prepara su propio estado y hace la llamada con el token indicado. */
type Caso = (token: string) => Promise<{ statusCode: number }>;

const CASOS: Partial<Record<Accion, Caso>> = {
  configurar_proyecto: (t) =>
    pedir(e, t, 'PATCH', `/proyectos/${o.esc.proyectoId}`, { dias_bloqueo: 15 }),
  administrar_usuarios: (t) => pedir(e, t, 'GET', '/admin/usuarios'),
  consultar_seguimiento: async (t) => pedir(e, t, 'GET', `/archivos/${await fotoVerificada()}/url`),
  // RF-W09: el Supervisor de campo (brigada A) descarga la plantilla de sus brigadas.
  sugerir_programacion: (t) =>
    pedir(e, t, 'GET', `/proyectos/${o.esc.proyectoId}/programacion/plantilla?con_datos=0`),
  resolver_revisiones: async (t) =>
    pedir(e, t, 'POST', `/revisiones/${await eventoEnRevision()}/resolver`, {
      decision: 'descartado',
    }),
};

/** Excepciones por alcance: el rol puede la acción, pero no sobre lo de otro. */
const ESPERADO_POR_ALCANCE: Partial<Record<Accion, Partial<Record<Rol, boolean>>>> = {
  // La foto es de otro especialista de la brigada: el especialista solo ve lo suyo.
  consultar_seguimiento: { especialista: false },
};

const casos = Object.entries(CASOS).flatMap(([accion, caso]) =>
  ROLES.map((rol) => [accion as Accion, rol, caso] as const),
);

describe('matriz de permisos (ERS §2.3)', () => {
  it.each(casos)('SEG-02 %s · %s', async (accion, rol, caso) => {
    const nivel = nivelPermiso(rol, accion);
    const permitido =
      ESPERADO_POR_ALCANCE[accion]?.[rol] ?? (nivel === 'total' || nivel === 'alcance');
    const r = await caso(personaDe(rol).token);
    if (permitido) expect(r.statusCode, `${accion} con ${rol}`).toBeLessThan(300);
    else expect([403, 404], `${accion} con ${rol}`).toContain(r.statusCode);
  });

  it('SEG-02 solo Coordinación y JdP arman brigadas', async () => {
    for (const rol of ROLES) {
      const r = await pedir(
        e,
        personaDe(rol).token,
        'POST',
        `/proyectos/${o.esc.proyectoId}/brigadas`,
        {
          nombre: `Nueva ${rol}`,
        },
      );
      if (rol === 'coordinacion' || rol === 'jefe_proyecto') expect(r.statusCode).toBe(201);
      else expect([403, 404]).toContain(r.statusCode);
    }
  });
});

describe('alcance horizontal (SEG-01)', () => {
  it('SEG-01 otra brigada: el Jefe de Brigada B no ve la foto ni los miembros de la brigada A', async () => {
    const archivo = await fotoVerificada('A');
    expect((await pedir(e, o.jefeB.token, 'GET', `/archivos/${archivo}/url`)).statusCode).toBe(404);
    expect(
      (await pedir(e, o.jefeB.token, 'GET', `/brigadas/${o.esc.brigadaId}/miembros`)).statusCode,
    ).toBe(404);
    const propia = await fotoVerificada('B');
    expect((await pedir(e, o.jefeB.token, 'GET', `/archivos/${propia}/url`)).statusCode).toBe(200);
  });

  it('SEG-01 otra brigada: el Jefe de Brigada B no resuelve un evento de la brigada A', async () => {
    const ev = await eventoEnRevision();
    const r = await pedir(e, o.jefeB.token, 'POST', `/revisiones/${ev}/resolver`, {
      decision: 'elegido',
    });
    expect([403, 404]).toContain(r.statusCode);
  });

  it('SEG-01 otro proyecto: un miembro de otro proyecto no lo ve', async () => {
    const otro = await organizacion(e);
    expect(
      (await pedir(e, otro.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}`)).statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, otro.especialista.token, 'GET', `/proyectos/${o.esc.proyectoId}/estaciones`))
        .statusCode,
    ).toBe(404);
    const archivo = await fotoVerificada('A');
    expect((await pedir(e, otro.jefeA.token, 'GET', `/archivos/${archivo}/url`)).statusCode).toBe(
      404,
    );
  });

  it('RN-25 especialista y supervisor de campo no ven los miembros; el Jefe de Brigada sí', async () => {
    for (const p of [o.especialista, o.supervisorA]) {
      expect(
        (await pedir(e, p.token, 'GET', `/brigadas/${o.esc.brigadaId}/miembros`)).statusCode,
      ).toBe(404);
    }
    expect(
      (await pedir(e, o.jefeA.token, 'GET', `/brigadas/${o.esc.brigadaId}/miembros`)).statusCode,
    ).toBe(200);
  });

  it('el Administrador técnico no ve proyectos ni fotos', async () => {
    expect((await pedir(e, o.admin.token, 'GET', '/proyectos')).json()).toEqual({ proyectos: [] });
    const archivo = await fotoVerificada('A');
    expect((await pedir(e, o.admin.token, 'GET', `/archivos/${archivo}/url`)).statusCode).toBe(404);
  });

  it('sin sesión ningún endpoint web responde', async () => {
    const r = await e.app.inject({
      method: 'GET',
      url: `/api/v1/proyectos/${o.esc.proyectoId}/estaciones`,
    });
    expect(r.statusCode).toBe(401);
  });
});
