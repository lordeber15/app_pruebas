import { ROLES, nivelPermiso, type Accion, type Rol } from '@campo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  completada,
  iniciarEntorno,
  nuevaTarea,
  organizacion,
  pedir,
  retener,
  type Entorno,
  type Organizacion,
  type Persona,
} from './entorno.ts';

/**
 * Prueba de la matriz de permisos (CLAUDE.md, Seguridad; doc. 01 §2.3; SEG-01 y SEG-02).
 * Se genera desde MATRIZ_PERMISOS de core: para cada acción con endpoint y cada rol, lo permitido
 * debe responder 2xx y lo no permitido 403/404. Los casos horizontales (otro proyecto, otra
 * cuadrilla) van al final.
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
    supervisor: o.supervisor,
    jefe: o.jefeA,
    especialista: o.especialista,
    logistico: o.logistico,
    admin: o.admin,
  })[rol];

/** Cada caso prepara su propio estado y hace la llamada con el token indicado. */
type Caso = (token: string) => Promise<{ statusCode: number }>;

const cuadernoConValidacion = async () => {
  const id = (
    await pedir(e, o.supervisor.token, 'POST', '/cuadernos', {
      cuadrilla_id: o.esc.cuadrillaId,
      responsable_id: o.especialista.id,
      titulo: 'Validación',
      validacion_activa: true,
    })
  ).json<{ id: string }>().id;
  return id;
};

const CASOS: Partial<Record<Accion, Caso>> = {
  configurar_proyecto: (t) =>
    pedir(e, t, 'PATCH', `/proyectos/${o.esc.proyectoId}`, { dias_bloqueo: 15 }),
  gestionar_cuadrillas: (t) =>
    pedir(e, t, 'POST', `/proyectos/${o.esc.proyectoId}/cuadrillas`, { nombre: 'Nueva' }),
  gestionar_cuadernos_tareas: (t) =>
    pedir(e, t, 'POST', '/tareas', { cuaderno_id: o.cuadernoA, titulo: 'Tarea de matriz' }),
  reasignar_tarea: async (t) => {
    const tarea = await nuevaTarea(e, o.esc, o.cuadernoA);
    return pedir(e, t, 'POST', `/tareas/${tarea}/reasignar`, { cuaderno_id: o.cuadernoA });
  },
  revocar_asignacion: async (t) => {
    const tarea = await nuevaTarea(e, o.esc, o.cuadernoA);
    await retener(e, tarea, o.especialista.id);
    return pedir(e, t, 'POST', `/tareas/${tarea}/revocar`, { motivo: 'Prueba de matriz' });
  },
  validar_tareas: async (t) => {
    const tarea = await nuevaTarea(e, o.esc, await cuadernoConValidacion());
    await completada(e, tarea, o.especialista.id);
    return pedir(e, t, 'POST', `/tareas/${tarea}/validar`, {});
  },
  reabrir_tareas: async (t) => {
    const tarea = await nuevaTarea(e, o.esc, o.cuadernoA);
    await completada(e, tarea, o.especialista.id);
    return pedir(e, t, 'POST', `/tareas/${tarea}/reabrir`, { motivo: 'Prueba de matriz' });
  },
  // La tarea es del especialista: el logístico de la cuadrilla no la ve (solo lo suyo).
  comentar_tareas: async (t) => {
    const tarea = await nuevaTarea(e, o.esc, o.cuadernoA);
    return pedir(e, t, 'POST', `/tareas/${tarea}/comentarios`, { texto: 'Comentario de matriz' });
  },
  ver_avance: (t) => pedir(e, t, 'GET', `/proyectos/${o.esc.proyectoId}/avance`),
  administrar_usuarios: (t) => pedir(e, t, 'GET', '/admin/usuarios'),
};

/** Excepciones por alcance: el rol puede la acción, pero no sobre lo de otro. */
const ESPERADO_POR_ALCANCE: Partial<Record<Accion, Partial<Record<Rol, boolean>>>> = {
  comentar_tareas: { logistico: false },
};

const casos = Object.entries(CASOS).flatMap(([accion, caso]) =>
  ROLES.map((rol) => [accion as Accion, rol, caso] as const),
);

describe('matriz de permisos (doc. 01 §2.3)', () => {
  it.each(casos)('SEG-02 %s · %s', async (accion, rol, caso) => {
    const nivel = nivelPermiso(rol, accion);
    const permitido =
      ESPERADO_POR_ALCANCE[accion]?.[rol] ?? (nivel === 'total' || nivel === 'alcance');
    const r = await caso(personaDe(rol).token);
    if (permitido) expect(r.statusCode, `${accion} con ${rol}`).toBeLessThan(300);
    else expect([403, 404], `${accion} con ${rol}`).toContain(r.statusCode);
  });
});

describe('alcance horizontal (SEG-01)', () => {
  it('SEG-01 otra cuadrilla: el jefe B no crea tareas en el cuaderno de la cuadrilla A', async () => {
    const r = await pedir(e, o.jefeB.token, 'POST', '/tareas', {
      cuaderno_id: o.cuadernoA,
      titulo: 'Intruso',
    });
    expect([403, 404]).toContain(r.statusCode);
  });

  it('SEG-01 otra cuadrilla: el jefe B no ve ni valida una tarea de la cuadrilla A', async () => {
    const tarea = await nuevaTarea(e, o.esc, o.cuadernoA);
    expect((await pedir(e, o.jefeB.token, 'GET', `/tareas/${tarea}`)).statusCode).toBe(404);
    expect([403, 404]).toContain(
      (await pedir(e, o.jefeB.token, 'POST', `/tareas/${tarea}/revocar`, { motivo: 'x' }))
        .statusCode,
    );
  });

  it('SEG-01 otro proyecto: un jefe sin cuadrillas en el proyecto no lo ve', async () => {
    const otro = await organizacion(e);
    expect(
      (await pedir(e, otro.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}`)).statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, otro.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}/tareas`)).json(),
    ).toEqual({ tareas: [], siguiente: null });
    expect(
      (await pedir(e, otro.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}/avance`)).statusCode,
    ).toBe(404);
  });

  it('SEG-01 el especialista no ve los miembros de su cuadrilla (RN-25)', async () => {
    expect(
      (await pedir(e, o.especialista.token, 'GET', `/cuadrillas/${o.esc.cuadrillaId}/miembros`))
        .statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, o.jefeA.token, 'GET', `/cuadrillas/${o.esc.cuadrillaId}/miembros`))
        .statusCode,
    ).toBe(200);
  });

  it('SEG-01 el especialista no ve la tarea de otro especialista de su cuadrilla', async () => {
    const cuadernoLog = (
      await pedir(e, o.supervisor.token, 'POST', '/cuadernos', {
        cuadrilla_id: o.esc.cuadrillaId,
        responsable_id: o.logistico.id,
        titulo: 'Del logístico',
      })
    ).json<{ id: string }>().id;
    const tarea = await nuevaTarea(e, o.esc, cuadernoLog, 'logistica');
    expect((await pedir(e, o.especialista.token, 'GET', `/tareas/${tarea}`)).statusCode).toBe(404);
  });

  it('sin sesión ningún endpoint web responde', async () => {
    const r = await e.app.inject({
      method: 'GET',
      url: `/api/v1/proyectos/${o.esc.proyectoId}/tareas`,
    });
    expect(r.statusCode).toBe(401);
  });
});
