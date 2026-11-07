import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  completada,
  entrar,
  especialistaEnCampo,
  forzarEstado,
  iniciarEntorno,
  nuevaTarea,
  organizacion,
  pedir,
  retener,
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

const estadoDe = async (id: string) =>
  (
    await e.admin
      .selectFrom('tarea')
      .select('estado')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).estado;

describe('proyectos (RF-W11)', () => {
  it('RN-27 CP-053 no se puede activar un séptimo proyecto', async () => {
    const activos = await e.admin
      .selectFrom('proyecto')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('estado', '=', 'activo')
      .executeTakeFirstOrThrow();
    for (let i = Number(activos.n); i < 6; i++) {
      const r = await pedir(e, o.supervisor.token, 'POST', '/proyectos', {
        nombre: `P${String(i)}`,
        validacion_activa: false,
      });
      expect(r.statusCode).toBe(201);
    }
    const septimo = await pedir(e, o.supervisor.token, 'POST', '/proyectos', {
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

  it('el jefe ve solo los proyectos donde tiene cuadrilla; el administrador no ve proyectos', async () => {
    const jefe = (await pedir(e, o.jefeA.token, 'GET', '/proyectos')).json<{
      proyectos: { id: string }[];
    }>();
    expect(jefe.proyectos.map((p) => p.id)).toEqual([o.esc.proyectoId]);
    const admin = (await pedir(e, o.admin.token, 'GET', '/proyectos')).json<{
      proyectos: unknown[];
    }>();
    expect(admin.proyectos).toEqual([]);
  });
});

describe('cuadernos y tareas', () => {
  it('el jefe crea tareas en su cuadrilla y nacen asignadas', async () => {
    const r = await pedir(e, o.jefeA.token, 'POST', '/tareas', {
      cuaderno_id: o.cuadernoA,
      titulo: 'Evaluar trampas',
    });
    expect(r.statusCode).toBe(201);
    expect(await estadoDe(r.json<{ id: string }>().id)).toBe('asignada');
  });

  it('RN-01 el responsable del cuaderno debe ser miembro de la cuadrilla', async () => {
    const r = await pedir(e, o.supervisor.token, 'POST', '/cuadernos', {
      cuadrilla_id: o.esc.cuadrillaId,
      responsable_id: o.especialistaB.id,
      titulo: 'Cuaderno inválido',
    });
    expect(r.statusCode).toBe(409);
  });

  it('una tarea con metodología no programada en la estación se rechaza', async () => {
    const r = await pedir(e, o.supervisor.token, 'POST', '/tareas', {
      cuaderno_id: o.cuadernoA,
      titulo: 'X',
      estacion_id: o.esc.estacionId,
      metodologia_id: generarId(),
    });
    expect(r.statusCode).toBe(409);
  });

  it('CP-042 el especialista solo ve sus propias tareas en el centro de tareas', async () => {
    const propia = await nuevaTarea(e, o.esc, o.cuadernoA);
    const deOtro = await nuevaTarea(e, { ...o.esc, cuadrillaId: o.cuadrillaB }, o.cuadernoB);
    const r = await pedir(
      e,
      o.especialista.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/tareas?limite=100`,
    );
    const ids = r.json<{ tareas: { id: string }[] }>().tareas.map((t) => t.id);
    expect(ids).toContain(propia);
    expect(ids).not.toContain(deOtro);
  });

  it('CP-042 filtra por estado y pagina con cursor', async () => {
    const t1 = await nuevaTarea(e, o.esc, o.cuadernoA);
    await forzarEstado(e, t1, 'validada');
    const r = await pedir(
      e,
      o.supervisor.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/tareas?estado=validada&limite=1`,
    );
    const cuerpo = r.json<{ tareas: { estado: string }[]; siguiente: string | null }>();
    expect(cuerpo.tareas.every((t) => t.estado === 'validada')).toBe(true);
    expect(cuerpo.tareas).toHaveLength(1);
  });
});

describe('reasignación y revocación (RN-07)', () => {
  it('CP-031 una tarea retenida no se reasigna sin revocar', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    await retener(e, t, o.especialista.id);
    const r = await pedir(e, o.supervisor.token, 'POST', `/tareas/${t}/reasignar`, {
      cuaderno_id: o.cuadernoA,
    });
    expect(r.json()).toMatchObject({ status: 409, codigo: 'TAREA_RETENIDA' });
  });

  it('CP-032 revocar sin motivo se rechaza', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    await retener(e, t, o.especialista.id);
    const r = await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/revocar`, { motivo: '  ' });
    expect(r.json()).toMatchObject({ codigo: 'MOTIVO_OBLIGATORIO' });
  });

  it('RN-07 revocar con motivo libera la tarea, que luego se reasigna a otro cuaderno', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    const { asignacionId } = await retener(e, t, o.especialista.id);
    const r = await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/revocar`, {
      motivo: 'Cambio de zona',
    });
    expect(r.json()).toEqual({ estado: 'asignada' });
    const a = await e.admin
      .selectFrom('asignacion')
      .select(['estado', 'motivo_revocacion'])
      .where('id', '=', asignacionId)
      .executeTakeFirstOrThrow();
    expect(a).toEqual({ estado: 'revocada', motivo_revocacion: 'Cambio de zona' });
    const otroCuaderno = (
      await pedir(e, o.supervisor.token, 'POST', '/cuadernos', {
        cuadrilla_id: o.esc.cuadrillaId,
        responsable_id: o.logistico.id,
        titulo: 'Logística',
      })
    ).json<{ id: string }>().id;
    expect(
      (
        await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/reasignar`, {
          cuaderno_id: otroCuaderno,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('SEG-01 el jefe no reasigna a un cuaderno de otra cuadrilla', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    const r = await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/reasignar`, {
      cuaderno_id: o.cuadernoB,
    });
    expect([403, 404]).toContain(r.statusCode);
  });
});

describe('validación (RN-06)', () => {
  it('CP-035 sin validación activa la tarea completada no se valida', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    await completada(e, t, o.especialista.id);
    const r = await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/validar`, {});
    expect(r.json()).toMatchObject({ codigo: 'VALIDACION_INACTIVA' });
  });

  it('CP-036 CP-037 con validación en el cuaderno se valida y la segunda validación queda ya aplicada', async () => {
    const cuaderno = (
      await pedir(e, o.supervisor.token, 'POST', '/cuadernos', {
        cuadrilla_id: o.esc.cuadrillaId,
        responsable_id: o.especialista.id,
        titulo: 'Con validación',
        validacion_activa: true,
      })
    ).json<{ id: string }>().id;
    const t = await nuevaTarea(e, o.esc, cuaderno);
    await completada(e, t, o.especialista.id);
    expect((await pedir(e, o.supervisor.token, 'POST', `/tareas/${t}/validar`, {})).json()).toEqual(
      { estado: 'validada', resultado: 'aplicado' },
    );
    expect((await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/validar`, {})).json()).toEqual({
      estado: 'validada',
      resultado: 'ya_aplicado',
    });
    const eventos = await e.admin
      .selectFrom('evento')
      .select('estado')
      .where('entidad_id', '=', t)
      .where('tipo', '=', 'validacion_registrada')
      .orderBy('hora_servidor')
      .execute();
    expect(eventos.map((x) => x.estado)).toEqual(['aplicado', 'ya_aplicado']);
  });

  it('observar devuelve la tarea al mismo celular con una asignación nueva y un comentario', async () => {
    const cuaderno = (
      await pedir(e, o.supervisor.token, 'POST', '/cuadernos', {
        cuadrilla_id: o.esc.cuadrillaId,
        responsable_id: o.especialista.id,
        titulo: 'Obs',
        validacion_activa: true,
      })
    ).json<{ id: string }>().id;
    const t = await nuevaTarea(e, o.esc, cuaderno);
    const { dispositivoId } = await completada(e, t, o.especialista.id);
    const r = await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/observar`, {
      comentario: 'Falta la foto de la trampa 3',
    });
    expect(r.json()).toMatchObject({ estado: 'observada' });
    const vigente = await e.admin
      .selectFrom('asignacion')
      .select('dispositivo_id')
      .where('tarea_id', '=', t)
      .where('estado', '=', 'vigente')
      .executeTakeFirstOrThrow();
    expect(vigente.dispositivo_id).toBe(dispositivoId);
    const det = (await pedir(e, o.especialista.token, 'GET', `/tareas/${t}`)).json<{
      comentarios: { texto: string }[];
    }>();
    expect(det.comentarios.map((c) => c.texto)).toContain('Falta la foto de la trampa 3');
  });

  it('la tarea observada llega al celular con su nueva asignación y vuelve a descargada', async () => {
    const yo = await especialistaEnCampo(e, o.esc);
    const cuaderno = (
      await pedir(e, o.supervisor.token, 'POST', '/cuadernos', {
        cuadrilla_id: o.esc.cuadrillaId,
        responsable_id: yo.usuario.id,
        titulo: 'Obs celular',
        validacion_activa: true,
      })
    ).json<{ id: string }>().id;
    const t = await nuevaTarea(e, o.esc, cuaderno);
    await e.admin
      .insertInto('asignacion')
      .values({
        id: generarId(),
        tarea_id: t,
        usuario_id: yo.usuario.id,
        dispositivo_id: yo.dispositivoId,
        descargada_en: new Date(),
        estado: 'finalizada',
        finalizada_en: new Date(),
      })
      .execute();
    await forzarEstado(e, t, 'completada');
    await pedir(e, o.supervisor.token, 'POST', `/tareas/${t}/observar`, {
      comentario: 'Repita la foto',
    });
    const cambios = (await pedir(e, yo.token, 'GET', '/sync/cambios')).json<{
      cambios: {
        id: string;
        operacion: string;
        datos: { asignacion_id?: string; estado?: string };
      }[];
    }>().cambios;
    const obs = cambios.find((c) => c.id === t && c.operacion === 'observada');
    const vigente = await e.admin
      .selectFrom('asignacion')
      .select('id')
      .where('tarea_id', '=', t)
      .where('estado', '=', 'vigente')
      .executeTakeFirstOrThrow();
    expect(obs?.datos).toEqual({ asignacion_id: vigente.id, estado: 'descargada' });
    expect(await estadoDe(t)).toBe('descargada');
  });

  it('RN-13 reabrir exige motivo y deja la tarea asignada', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    await completada(e, t, o.especialista.id);
    expect(
      (await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/reabrir`, { motivo: '' })).json(),
    ).toMatchObject({ codigo: 'MOTIVO_OBLIGATORIO' });
    expect(
      (
        await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/reabrir`, { motivo: 'Repetir conteo' })
      ).json(),
    ).toEqual({ estado: 'asignada' });
  });
});

describe('cierre de tareas por regla (RN-04)', () => {
  const tareaPorRegla = async () => {
    const regla = generarId();
    await e.admin
      .insertInto('regla_alerta')
      .values({
        id: regla,
        proyecto_id: o.esc.proyectoId,
        tipo: 'evidencia_faltante',
        condicion: '{}',
        severidad: 'media',
        ambito: 'servidor',
        responsable_rol: 'jefe',
      })
      .execute();
    const t = generarId();
    await e.admin
      .insertInto('tarea')
      .values({
        id: t,
        proyecto_id: o.esc.proyectoId,
        cuaderno_id: o.cuadernoA,
        origen: 'regla',
        regla_id: regla,
        clave_dedup: `r:${t}`,
        tipo: 'tecnica',
        titulo: 'Alerta',
        estado: 'asignada',
      })
      .execute();
    return t;
  };

  it('CP-056 se cierra con comentario y rol de supervisor o jefe, sin foto', async () => {
    const t = await tareaPorRegla();
    expect(
      (await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/cerrar`, { comentario: '' })).json(),
    ).toMatchObject({ codigo: 'COMENTARIO_OBLIGATORIO' });
    expect(
      (await pedir(e, o.especialista.token, 'POST', `/tareas/${t}/cerrar`, { comentario: 'Listo' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/cerrar`, {
          comentario: 'Verificado por radio',
        })
      ).json(),
    ).toEqual({ estado: 'cerrada' });
  });

  it('CP-056 una tarea manual no se cierra sin foto', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    expect(
      (await pedir(e, o.jefeA.token, 'POST', `/tareas/${t}/cerrar`, { comentario: 'x' })).json(),
    ).toMatchObject({ codigo: 'SOLO_TAREA_POR_REGLA' });
  });
});

describe('archivos, avance y mapa', () => {
  const archivoVerificado = async (
    cuaderno: string,
    usuarioId: string,
    cuadrillaId = o.esc.cuadrillaId,
  ) => {
    const t = await nuevaTarea(e, { ...o.esc, cuadrillaId }, cuaderno);
    const id = generarId();
    await e.admin
      .insertInto('archivo')
      .values({
        id,
        proyecto_id: o.esc.proyectoId,
        usuario_id: usuarioId,
        tarea_id: t,
        tipo: 'foto',
        hash_preview: 'a'.repeat(64),
        tamano_preview: '1000',
        ruta_preview: `proyectos/${o.esc.proyectoId}/archivos/${id}/preview/x.jpg`,
        ruta_miniatura: `proyectos/${o.esc.proyectoId}/archivos/${id}/miniatura.jpg`,
        estado: 'preview_verificada',
        capturado_en: new Date(),
      })
      .execute();
    return id;
  };

  it('SEG-03 la URL firmada se emite tras verificar el alcance y dura 15 minutos', async () => {
    const id = await archivoVerificado(o.cuadernoA, o.especialista.id);
    const r = await pedir(e, o.jefeA.token, 'GET', `/archivos/${id}/url?variante=miniatura`);
    const url = new URL(r.json<{ url: string }>().url);
    expect(url.host).toBe('almacen.prueba');
    expect(url.pathname).toContain(
      `/archivos/proyectos/${o.esc.proyectoId}/archivos/${id}/miniatura.jpg`,
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('SEG-03 RN-21 el jefe de otra cuadrilla y otro especialista no obtienen la URL', async () => {
    const id = await archivoVerificado(o.cuadernoA, o.especialista.id);
    expect((await pedir(e, o.jefeB.token, 'GET', `/archivos/${id}/url`)).statusCode).toBe(404);
    expect((await pedir(e, o.especialistaB.token, 'GET', `/archivos/${id}/url`)).statusCode).toBe(
      404,
    );
  });

  it('una variante aún no verificada no tiene URL', async () => {
    const id = await archivoVerificado(o.cuadernoA, o.especialista.id);
    expect(
      (await pedir(e, o.supervisor.token, 'GET', `/archivos/${id}/url?variante=original`))
        .statusCode,
    ).toBe(404);
  });

  it('RN-19 el avance suma el esfuerzo de todos y cuenta tareas por estado', async () => {
    const r = await pedir(e, o.supervisor.token, 'GET', `/proyectos/${o.esc.proyectoId}/avance`);
    const cuerpo = r.json<{
      cuadrillas: { id: string }[];
      esfuerzo: { id: string; meta: number | null }[];
    }>();
    expect(cuerpo.cuadrillas.map((c) => c.id)).toContain(o.esc.cuadrillaId);
    expect(cuerpo.esfuerzo).toContainEqual(
      expect.objectContaining({ id: o.esc.estacionMetodologiaId, meta: 40 }),
    );
  });

  it('el mapa devuelve tareas y estaciones en GeoJSON', async () => {
    const r = await pedir(e, o.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}/mapa`);
    const fc = r.json<{ type: string; features: { properties: { capa: string } }[] }>();
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.some((f) => f.properties.capa === 'estacion')).toBe(true);
    expect(fc.features.some((f) => f.properties.capa === 'tarea')).toBe(true);
  });
});

describe('revisiones (RN-08)', () => {
  it('el jefe ve y resuelve un evento en revisión de su cuadrilla', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    const ev = generarId();
    await e.admin
      .insertInto('evento')
      .values({
        id: ev,
        tipo: 'comentario_creado',
        version_esquema: 1,
        usuario_id: o.especialista.id,
        entidad_tipo: 'tarea',
        entidad_id: t,
        payload: '{}',
        estado: 'en_revision',
        motivo: 'ASIGNACION_REVOCADA',
      })
      .execute();
    const lista = (
      await pedir(e, o.jefeA.token, 'GET', `/proyectos/${o.esc.proyectoId}/revisiones`)
    ).json<{ revisiones: { id: string }[] }>();
    expect(lista.revisiones.map((r) => r.id)).toContain(ev);
    expect(
      (await pedir(e, o.jefeB.token, 'POST', `/revisiones/${ev}/resolver`, { decision: 'elegido' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await pedir(e, o.jefeA.token, 'POST', `/revisiones/${ev}/resolver`, {
          decision: 'descartado',
        })
      ).statusCode,
    ).toBe(204);
    const fila = await e.admin
      .selectFrom('evento')
      .select(['estado', 'resuelto_por'])
      .where('id', '=', ev)
      .executeTakeFirstOrThrow();
    expect(fila).toEqual({ estado: 'resuelto_descartado', resuelto_por: o.jefeA.id });
  });

  it('un evento de archivo en revisión aparece por la tarea de su payload', async () => {
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    const ev = generarId();
    await e.admin
      .insertInto('evento')
      .values({
        id: ev,
        tipo: 'archivo_capturado',
        version_esquema: 1,
        usuario_id: o.especialista.id,
        entidad_tipo: 'archivo',
        entidad_id: generarId(),
        payload: JSON.stringify({ tarea_id: t }),
        estado: 'duplicado',
        motivo: 'TAREA_COMPLETADA_POR_OTRO',
      })
      .execute();
    const lista = (
      await pedir(e, o.supervisor.token, 'GET', `/proyectos/${o.esc.proyectoId}/revisiones`)
    ).json<{ revisiones: { id: string }[] }>();
    expect(lista.revisiones.map((r) => r.id)).toContain(ev);
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
    const t = await nuevaTarea(e, o.esc, o.cuadernoA);
    const { dispositivoId } = await retener(e, t, o.especialista.id);
    expect(
      (await pedir(e, o.admin.token, 'POST', `/admin/dispositivos/${dispositivoId}/baja`))
        .statusCode,
    ).toBe(204);
    const d = await e.admin
      .selectFrom('dispositivo')
      .select('estado')
      .where('id', '=', dispositivoId)
      .executeTakeFirstOrThrow();
    expect(d.estado).toBe('baja_pendiente');
  });
});
