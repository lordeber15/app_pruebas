import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  agregarMiembro,
  enCampo,
  entrar,
  iniciarEntorno,
  lote,
  organizacion,
  pedir,
  persona,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

let e: Entorno;
let o: Organizacion;

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
});
afterAll(async () => {
  await e.cerrar();
});

describe('proyectos (RF-W11)', () => {
  it('RN-27 CP-053 no se puede activar un séptimo proyecto', async () => {
    const activos = await e.admin
      .selectFrom('proyecto')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('estado', '=', 'activo')
      .executeTakeFirstOrThrow();
    for (let i = Number(activos.n); i < 6; i++) {
      const r = await pedir(e, o.coordinacion.token, 'POST', '/proyectos', {
        nombre: `P${String(i)}`,
        validacion_activa: false,
      });
      expect(r.statusCode).toBe(201);
    }
    const septimo = await pedir(e, o.coordinacion.token, 'POST', '/proyectos', {
      nombre: 'Séptimo',
      validacion_activa: false,
    });
    expect(septimo.statusCode).toBe(409);
    expect(septimo.json()).toMatchObject({ codigo: 'MAXIMO_PROYECTOS' });
    // Se cierran para no afectar al resto de pruebas.
    await e.admin
      .updateTable('proyecto')
      .set({ estado: 'cerrado' })
      .where('nombre', 'like', 'P%')
      .where('id', '!=', o.esc.proyectoId)
      .execute();
  });

  it('los miembros ven solo los proyectos de su brigada; el Administrador técnico no ve proyectos', async () => {
    for (const p of [o.jefeA, o.supervisorA, o.especialista]) {
      const r = (await pedir(e, p.token, 'GET', '/proyectos')).json<{
        proyectos: { id: string }[];
      }>();
      expect(r.proyectos.map((x) => x.id)).toEqual([o.esc.proyectoId]);
    }
    expect((await pedir(e, o.admin.token, 'GET', '/proyectos')).json()).toEqual({ proyectos: [] });
  });

  it('Coordinación y el Jefe de Proyecto ven todos los proyectos', async () => {
    for (const p of [o.coordinacion, o.jefeProyecto]) {
      const r = (await pedir(e, p.token, 'GET', '/proyectos')).json<{
        proyectos: { id: string }[];
      }>();
      expect(r.proyectos.map((x) => x.id)).toContain(o.esc.proyectoId);
    }
  });
});

describe('brigadas, miembros y estaciones', () => {
  it('Coordinación agrega miembros con los roles TOCE y rechaza los del modelo anterior', async () => {
    const nueva = (await persona(e)).id;
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/brigadas/${o.esc.brigadaId}/miembros`,
      {
        usuario_id: nueva,
        rol: 'supervisor_campo',
      },
    );
    expect(r.statusCode).toBe(201);
    const viejo = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/brigadas/${o.esc.brigadaId}/miembros`,
      {
        usuario_id: o.jefeB.id,
        rol: 'logistico',
      },
    );
    expect(viejo.statusCode).toBe(400);
    const miembros = (
      await pedir(e, o.jefeA.token, 'GET', `/brigadas/${o.esc.brigadaId}/miembros`)
    ).json<{ miembros: { usuario_id: string; rol: string }[] }>().miembros;
    expect(miembros).toContainEqual(
      expect.objectContaining({ usuario_id: nueva, rol: 'supervisor_campo' }),
    );
    expect(miembros).toContainEqual(
      expect.objectContaining({ usuario_id: o.jefeA.id, rol: 'jefe_brigada' }),
    );
  });

  it('RN-29 las estaciones llegan con sus atributos de A01', async () => {
    const r = (
      await pedir(e, o.especialista.token, 'GET', `/proyectos/${o.esc.proyectoId}/estaciones`)
    ).json<{
      estaciones: { id: string; codigo: string; lat: number; lon: number; za_ef: string | null }[];
    }>();
    expect(r.estaciones).toContainEqual(
      expect.objectContaining({ id: o.esc.estacionId, lat: -12.04, lon: -77.03, za_ef: null }),
    );
  });

  it('/yo devuelve el rol global y las membresías con su rol', async () => {
    const yo = (await pedir(e, o.jefeA.token, 'GET', '/yo')).json<{
      rol_global: string;
      membresias: { brigada_id: string; rol: string }[];
    }>();
    expect(yo.rol_global).toBe('ninguno');
    expect(yo.membresias).toEqual([{ brigada_id: o.esc.brigadaId, rol: 'jefe_brigada' }]);
  });
});

describe('archivos (SEG-03)', () => {
  /** Foto verificada de un especialista nuevo de la brigada A. */
  const archivoVerificado = async () => {
    const autor = await enCampo(e, o.esc.brigadaId);
    const ejecucionId = generarId();
    const archivoId = generarId();
    await lote(e, autor.token, [abrir(ejecucionId, o.esc)]);
    await e.admin
      .insertInto('archivo')
      .values({
        id: archivoId,
        proyecto_id: o.esc.proyectoId,
        usuario_id: autor.usuario.id,
        ejecucion_id: ejecucionId,
        tipo: 'foto',
        hash_preview: 'a'.repeat(64),
        tamano_preview: '1000',
        ruta_preview: `proyectos/${o.esc.proyectoId}/archivos/${archivoId}/preview/x.jpg`,
        ruta_miniatura: `proyectos/${o.esc.proyectoId}/archivos/${archivoId}/miniatura.jpg`,
        estado: 'preview_verificada',
        capturado_en: new Date(),
      })
      .execute();
    return { archivoId, autor };
  };

  it('SEG-03 la URL firmada se emite tras verificar el alcance y dura 15 minutos', async () => {
    const { archivoId } = await archivoVerificado();
    const r = await pedir(e, o.jefeA.token, 'GET', `/archivos/${archivoId}/url?variante=miniatura`);
    const url = new URL(r.json<{ url: string }>().url);
    expect(url.host).toBe('almacen.prueba');
    expect(url.pathname).toContain(
      `/archivos/proyectos/${o.esc.proyectoId}/archivos/${archivoId}/miniatura.jpg`,
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('SEG-03 el Jefe de Brigada de otra brigada y otro especialista no obtienen la URL', async () => {
    const { archivoId } = await archivoVerificado();
    expect((await pedir(e, o.jefeB.token, 'GET', `/archivos/${archivoId}/url`)).statusCode).toBe(
      404,
    );
    expect(
      (await pedir(e, o.especialistaB.token, 'GET', `/archivos/${archivoId}/url`)).statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, o.especialista.token, 'GET', `/archivos/${archivoId}/url`)).statusCode,
    ).toBe(404);
  });

  it('una variante aún no verificada no tiene URL', async () => {
    const { archivoId } = await archivoVerificado();
    expect(
      (await pedir(e, o.coordinacion.token, 'GET', `/archivos/${archivoId}/url?variante=original`))
        .statusCode,
    ).toBe(404);
  });
});

describe('revisiones (RN-13)', () => {
  /** Evento en revisión ligado a una ejecución de la brigada A. */
  const enRevision = async (tipo: 'ejecucion' | 'archivo') => {
    const autor = await enCampo(e, o.esc.brigadaId);
    const ejecucionId = generarId();
    await lote(e, autor.token, [abrir(ejecucionId, o.esc)]);
    const ev = generarId();
    await e.admin
      .insertInto('evento')
      .values({
        id: ev,
        tipo: tipo === 'ejecucion' ? 'ejecucion_cerrada' : 'archivo_capturado',
        version_esquema: 1,
        usuario_id: autor.usuario.id,
        entidad_tipo: tipo,
        entidad_id: tipo === 'ejecucion' ? ejecucionId : generarId(),
        payload: JSON.stringify({ ejecucion_id: ejecucionId }),
        estado: tipo === 'ejecucion' ? 'en_revision' : 'duplicado',
        motivo: tipo === 'ejecucion' ? 'EJECUCION_CERRADA' : 'ENTIDAD_DUPLICADA',
      })
      .execute();
    return ev;
  };

  it('Coordinación ve y resuelve un evento en revisión; el Jefe de Brigada no lo resuelve', async () => {
    const ev = await enRevision('ejecucion');
    const lista = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${o.esc.proyectoId}/revisiones`)
    ).json<{ revisiones: { id: string; estacion_codigo: string }[] }>();
    expect(lista.revisiones.map((r) => r.id)).toContain(ev);
    expect(
      (await pedir(e, o.jefeA.token, 'POST', `/revisiones/${ev}/resolver`, { decision: 'elegido' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await pedir(e, o.coordinacion.token, 'POST', `/revisiones/${ev}/resolver`, {
          decision: 'descartado',
        })
      ).statusCode,
    ).toBe(204);
    const fila = await e.admin
      .selectFrom('evento')
      .select(['estado', 'resuelto_por'])
      .where('id', '=', ev)
      .executeTakeFirstOrThrow();
    expect(fila).toEqual({ estado: 'resuelto_descartado', resuelto_por: o.coordinacion.id });
    expect(
      (
        await pedir(e, o.coordinacion.token, 'POST', `/revisiones/${ev}/resolver`, {
          decision: 'elegido',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('un evento de foto en revisión aparece por la ejecución de su payload', async () => {
    const ev = await enRevision('archivo');
    const lista = (
      await pedir(e, o.jefeProyecto.token, 'GET', `/proyectos/${o.esc.proyectoId}/revisiones`)
    ).json<{ revisiones: { id: string }[] }>();
    expect(lista.revisiones.map((r) => r.id)).toContain(ev);
    const delJefe = (
      await pedir(e, o.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}/revisiones`)
    ).json<{ revisiones: unknown[] }>();
    expect(delJefe.revisiones).toEqual([]);
  });
});

describe('administración de usuarios', () => {
  it('el administrador da de alta un usuario que entra con su contraseña temporal', async () => {
    const r = await pedir(e, o.admin.token, 'POST', '/admin/usuarios', {
      tipo_documento: 'dni',
      num_documento: '61234567',
      nombre: 'Nueva Especialista',
    });
    expect(r.statusCode).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    const { contrasena_temporal: clave } = r.json<{ contrasena_temporal: string }>();
    expect((await entrar(e, 'dni.61234567', clave)).statusCode).toBe(200);
  });

  it('los roles globales son los de TOCE', async () => {
    const ok = await pedir(e, o.coordinacion.token, 'POST', '/admin/usuarios', {
      tipo_documento: 'DNI',
      num_documento: '61234570',
      nombre: 'Jefa de Proyecto',
      rol_global: 'jefe_proyecto',
    });
    expect(ok.statusCode).toBe(201);
    const viejo = await pedir(e, o.coordinacion.token, 'POST', '/admin/usuarios', {
      tipo_documento: 'DNI',
      num_documento: '61234571',
      nombre: 'Supervisor',
      rol_global: 'supervisor',
    });
    expect(viejo.statusCode).toBe(400);
  });

  it('un documento repetido da conflicto', async () => {
    await pedir(e, o.admin.token, 'POST', '/admin/usuarios', {
      tipo_documento: 'DNI',
      num_documento: '61234568',
      nombre: 'A',
    });
    const r = await pedir(e, o.admin.token, 'POST', '/admin/usuarios', {
      tipo_documento: 'DNI',
      num_documento: '61234568',
      nombre: 'B',
    });
    expect(r.statusCode).toBe(409);
  });

  it('al desactivar un usuario se cierran sus sesiones', async () => {
    const r = await pedir(e, o.admin.token, 'POST', '/admin/usuarios', {
      tipo_documento: 'DNI',
      num_documento: '61234569',
      nombre: 'Temporal',
    });
    const { id, contrasena_temporal: clave } = r.json<{
      id: string;
      contrasena_temporal: string;
    }>();
    const token = (await entrar(e, 'dni.61234569', clave)).headers['set-auth-token'] as string;
    expect(
      (await pedir(e, o.admin.token, 'PATCH', `/admin/usuarios/${id}`, { estado: 'inactivo' }))
        .statusCode,
    ).toBe(204);
    expect((await pedir(e, token, 'GET', '/yo')).statusCode).toBe(401);
  });

  it('RF-M17 la baja remota deja el dispositivo con baja pendiente', async () => {
    const d = await enCampo(e, o.esc.brigadaId);
    expect(
      (await pedir(e, o.admin.token, 'POST', `/admin/dispositivos/${d.dispositivoId}/baja`))
        .statusCode,
    ).toBe(204);
    const fila = await e.admin
      .selectFrom('dispositivo')
      .select('estado')
      .where('id', '=', d.dispositivoId)
      .executeTakeFirstOrThrow();
    expect(fila.estado).toBe('baja_pendiente');
  });

  it('un usuario sin rol de brigada todavía puede agregarse a una brigada', async () => {
    const u = await enCampo(e, o.esc.brigadaB, 'jefe_brigada');
    await agregarMiembro(e, o.esc.brigadaId, u.usuario.id);
    const yo = (await pedir(e, u.token, 'GET', '/yo')).json<{ membresias: unknown[] }>();
    expect(yo.membresias).toHaveLength(2);
  });
});
