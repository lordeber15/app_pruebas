import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  agregarMiembro,
  conToken,
  descargar,
  enviarLote,
  especialistaEnCampo,
  iniciarEntorno,
  nuevaLlave,
  nuevaTarea,
  nuevoCuaderno,
  nuevoEscenario,
  nuevoUsuario,
  tokenDe,
  usuarioConDispositivo,
  type Entorno,
  type Escenario,
} from './entorno.ts';

let e: Entorno;
let esc: Escenario;

beforeAll(async () => {
  e = await iniciarEntorno();
  esc = await nuevoEscenario(e);
});
afterAll(async () => {
  await e.cerrar();
});

const HASH = 'ab'.repeat(32);
const HORA = '2026-11-10T15:42:07.120-05:00';
const UBICACION = { lat: -12.04, lon: -77.03, precision_m: 8, altitud_m: 154 };

type Resultado = { id: string; estado: string; motivo?: string };
type Respuesta = Awaited<ReturnType<Entorno['app']['inject']>>;
const resultados = (r: Respuesta) => r.json<{ resultados: Resultado[] }>().resultados;

const sobre = <P>(
  tipo: string,
  entidad: { tipo: string; id: string },
  payload: P,
  asignacionId: string | null,
) => ({
  id: generarId(),
  tipo,
  version_esquema: 1,
  asignacion_id: asignacionId,
  entidad,
  hora_dispositivo: HORA,
  ubicacion: UBICACION,
  payload,
});

const foto = (tareaId: string, asignacionId: string, archivoId = generarId()) =>
  sobre(
    'archivo_capturado',
    { tipo: 'archivo', id: archivoId },
    {
      archivo_id: archivoId,
      tipo: 'foto',
      tarea_id: tareaId,
      evidencia_item_id: null,
      categoria_id: null,
      hash_preview: HASH,
      hash_original: HASH,
      tamanos: { preview: 900_000, original: 6_000_000 },
      capturado_en: HORA,
    },
    asignacionId,
  );

const completar = (tareaId: string, asignacionId: string, archivoIds: string[]) =>
  sobre(
    'tarea_completada',
    { tipo: 'tarea', id: tareaId },
    { tarea_id: tareaId, archivo_ids: archivoIds },
    asignacionId,
  );

const estadoTarea = async (id: string) =>
  (
    await e.admin
      .selectFrom('tarea')
      .select('estado')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).estado;

/** Especialista con una tarea ya descargada en su dispositivo. */
const tareaDescargada = async () => {
  const yo = await especialistaEnCampo(e, esc);
  const tareaId = await nuevaTarea(e, esc, yo.cuadernoId);
  const r = await descargar(e, yo.token, [tareaId]);
  const asignacionId = r.json<{ asignaciones: { asignacion_id: string }[] }>().asignaciones[0]
    ?.asignacion_id;
  if (asignacionId === undefined) throw new Error('No se descargó la tarea');
  return { yo, tareaId, asignacionId };
};

describe('paquete de campo', () => {
  it('CP-007 RN-03 descargar 3 de 5 tareas: 3 quedan descargadas y 2 siguen asignadas', async () => {
    const yo = await especialistaEnCampo(e, esc);
    const tareas = await Promise.all([1, 2, 3, 4, 5].map(() => nuevaTarea(e, esc, yo.cuadernoId)));
    const disp = await e.app.inject({
      method: 'GET',
      url: '/api/v1/paquete/disponible',
      headers: conToken(yo.token),
    });
    expect(disp.json<{ tareas: unknown[] }>().tareas).toHaveLength(5);

    const r = await descargar(e, yo.token, tareas.slice(0, 3));
    expect(r.statusCode).toBe(200);
    expect(r.json<{ asignaciones: unknown[] }>().asignaciones).toHaveLength(3);
    expect(await Promise.all(tareas.map(estadoTarea))).toEqual([
      'descargada',
      'descargada',
      'descargada',
      'asignada',
      'asignada',
    ]);
    const vigentes = await e.admin
      .selectFrom('asignacion')
      .select(['usuario_id', 'dispositivo_id'])
      .where('tarea_id', 'in', tareas)
      .where('estado', '=', 'vigente')
      .execute();
    expect(vigentes).toHaveLength(3);
    expect(
      vigentes.every(
        (v) => v.usuario_id === yo.usuario.id && v.dispositivo_id === yo.dispositivoId,
      ),
    ).toBe(true);
  });

  it('RN-02 una tarea retenida no se descarga en un segundo dispositivo', async () => {
    const { yo, tareaId } = await tareaDescargada();
    // Mismo usuario, otro celular.
    const token2 = await tokenDe(e, yo.usuario.username, yo.usuario.contrasena);
    await e.app.inject({
      method: 'POST',
      url: '/api/v1/dispositivos/activar',
      headers: conToken(token2),
      payload: {
        plataforma: 'ios',
        llave_publica: nuevaLlave().publicaSpki,
        version_app: '0.1.0',
        token_push: null,
      },
    });
    const r = await descargar(e, token2, [tareaId]);
    expect(r.json()).toMatchObject({
      asignaciones: [],
      rechazadas: [{ tarea_id: tareaId, motivo: 'TAREA_RETENIDA' }],
    });
  });

  it('SEG-01 no se descargan ni se listan tareas de otro usuario', async () => {
    const otro = await especialistaEnCampo(e, esc);
    const ajena = await nuevaTarea(e, esc, otro.cuadernoId);
    const yo = await especialistaEnCampo(e, esc);
    const disp = await e.app.inject({
      method: 'GET',
      url: '/api/v1/paquete/disponible',
      headers: conToken(yo.token),
    });
    expect(disp.json<{ tareas: { id: string }[] }>().tareas.map((t) => t.id)).not.toContain(ajena);
    const r = await descargar(e, yo.token, [ajena]);
    expect(r.json()).toMatchObject({ rechazadas: [{ tarea_id: ajena, motivo: 'NO_DISPONIBLE' }] });
    expect(await estadoTarea(ajena)).toBe('asignada');
  });

  it('SEG-02 el logístico no descarga tareas técnicas', async () => {
    const log = await usuarioConDispositivo(e);
    await agregarMiembro(e, esc, log.usuario.id, 'logistico');
    const cuaderno = await nuevoCuaderno(e, esc, log.usuario.id);
    const tecnica = await nuevaTarea(e, esc, cuaderno, 'tecnica');
    const logistica = await nuevaTarea(e, esc, cuaderno, 'logistica');
    const r = await descargar(e, log.token, [tecnica, logistica]);
    expect(r.json()).toMatchObject({
      asignaciones: [{ tarea_id: logistica }],
      rechazadas: [{ tarea_id: tecnica, motivo: 'NO_DISPONIBLE' }],
    });
  });

  it('SEG-02 un usuario sin rol de campo no puede descargar', async () => {
    const sup = await usuarioConDispositivo(e);
    const r = await descargar(e, sup.token, [generarId()]);
    expect(r.statusCode).toBe(403);
  });

  it('RN-25 el paquete no lleva usuarios ni datos personales', async () => {
    const yo = await especialistaEnCampo(e, esc);
    const tareaId = await nuevaTarea(e, esc, yo.cuadernoId);
    const r = await descargar(e, yo.token, [tareaId]);
    const texto = r.body;
    expect(texto).not.toContain(yo.usuario.id);
    expect(texto).not.toContain(yo.usuario.username.split('.')[1] ?? '-');
    expect(texto).not.toMatch(/responsable|num_documento|nombre_usuario|celular/);
    const paquete = r.json<{
      paquete: { tareas: unknown[]; estaciones: unknown[]; metodologias: unknown[] };
    }>().paquete;
    expect(paquete.tareas).toHaveLength(1);
    expect(paquete.estaciones).toHaveLength(1);
    expect(paquete.metodologias).toHaveLength(1);
  });

  it('una sesión sin dispositivo no descarga', async () => {
    const u = await nuevoUsuario(e);
    const token = await tokenDe(e, u.username, u.contrasena);
    expect((await descargar(e, token, [generarId()])).statusCode).toBe(403);
  });
});

describe('sincronización de eventos', () => {
  it('CP-025 RN-05 completar con foto deja la tarea en tránsito y finaliza la asignación', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    const itemId = generarId();
    const f = foto(tareaId, asignacionId);
    const r = await enviarLote(e, yo.token, [
      sobre(
        'evidencia_item_creado',
        { tipo: 'evidencia_item', id: itemId },
        {
          tarea_id: tareaId,
          descripcion: 'Trampa 1',
          geom: { type: 'Point', coordinates: [-77.03, -12.04] },
          orden: 0,
        },
        asignacionId,
      ),
      f,
      completar(tareaId, asignacionId, [f.payload.archivo_id]),
    ]);
    expect(r.statusCode).toBe(200);
    expect(resultados(r).map((x) => x.estado)).toEqual(['aplicado', 'aplicado', 'aplicado']);
    expect(await estadoTarea(tareaId)).toBe('en_transito');
    const asig = await e.admin
      .selectFrom('asignacion')
      .select('estado')
      .where('id', '=', asignacionId)
      .executeTakeFirstOrThrow();
    expect(asig.estado).toBe('finalizada');
    const archivo = await e.admin
      .selectFrom('archivo')
      .select(['estado', 'usuario_id'])
      .where('id', '=', f.payload.archivo_id)
      .executeTakeFirstOrThrow();
    expect(archivo).toEqual({ estado: 'anunciado', usuario_id: yo.usuario.id });
  });

  it('RN-04 CP-011 completar sin una foto anunciada queda no aplicado', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    const r = await enviarLote(e, yo.token, [completar(tareaId, asignacionId, [generarId()])]);
    expect(resultados(r)[0]).toMatchObject({ estado: 'no_aplicado', motivo: 'SIN_FOTO' });
    expect(await estadoTarea(tareaId)).toBe('descargada');
  });

  it('CP-026 RN-10 reenviar el mismo lote no duplica nada', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    const f = foto(tareaId, asignacionId);
    const lote = [f, completar(tareaId, asignacionId, [f.payload.archivo_id])];
    await enviarLote(e, yo.token, lote);
    const otraVez = await enviarLote(e, yo.token, lote);
    expect(resultados(otraVez).map((x) => x.estado)).toEqual(['ya_aplicado', 'ya_aplicado']);
    const eventos = await e.admin
      .selectFrom('evento')
      .select('id')
      .where(
        'id',
        'in',
        lote.map((x) => x.id),
      )
      .execute();
    expect(eventos).toHaveLength(2);
  });

  it('RN-12 al reenviar un evento no aplicado se repite su motivo', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    const ev = completar(tareaId, asignacionId, [generarId()]);
    await enviarLote(e, yo.token, [ev]);
    expect(resultados(await enviarLote(e, yo.token, [ev]))[0]).toMatchObject({
      estado: 'no_aplicado',
      motivo: 'SIN_FOTO',
    });
  });

  it('RN-11 completar dos veces con la misma asignación aplica solo la primera', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    const f = foto(tareaId, asignacionId);
    await enviarLote(e, yo.token, [f, completar(tareaId, asignacionId, [f.payload.archivo_id])]);
    const segunda = await enviarLote(e, yo.token, [
      completar(tareaId, asignacionId, [f.payload.archivo_id]),
    ]);
    expect(resultados(segunda)[0]?.estado).toBe('ya_aplicado');
  });

  it('CP-039 RN-12 SEG-01 un evento sobre la asignación de otro usuario queda no aplicado', async () => {
    const { tareaId, asignacionId } = await tareaDescargada();
    const intruso = await especialistaEnCampo(e, esc);
    const r = await enviarLote(e, intruso.token, [foto(tareaId, asignacionId)]);
    expect(resultados(r)[0]).toMatchObject({ estado: 'no_aplicado', motivo: 'ASIGNACION_AJENA' });
    const guardado = await e.admin
      .selectFrom('evento')
      .select(['usuario_id', 'estado'])
      .where('id', '=', resultados(r)[0]?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(guardado).toEqual({ usuario_id: intruso.usuario.id, estado: 'no_aplicado' });
  });

  it('usuario_id y dispositivo_id del cuerpo deben coincidir con la sesión', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    const ev = { ...foto(tareaId, asignacionId), usuario_id: generarId() };
    const r = await enviarLote(e, yo.token, [ev]);
    expect(resultados(r)[0]).toMatchObject({
      estado: 'no_aplicado',
      motivo: 'IDENTIDAD_NO_COINCIDE',
    });
    const fila = await e.admin
      .selectFrom('evento')
      .select('usuario_id')
      .where('id', '=', ev.id)
      .executeTakeFirstOrThrow();
    expect(fila.usuario_id).toBe(yo.usuario.id);
  });

  it('CP-033 RN-08 los eventos de una asignación revocada quedan en revisión', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    await e.admin
      .updateTable('asignacion')
      .set({ estado: 'revocada', motivo_revocacion: 'Reasignación por salud' })
      .where('id', '=', asignacionId)
      .execute();
    await e.admin
      .updateTable('tarea')
      .set({ estado: 'asignada' })
      .where('id', '=', tareaId)
      .execute();
    const f = foto(tareaId, asignacionId);
    const r = await enviarLote(e, yo.token, [f]);
    expect(resultados(r)[0]).toMatchObject({
      estado: 'en_revision',
      motivo: 'ASIGNACION_REVOCADA',
    });
    // Se conserva el evento, pero no se aplica a las proyecciones.
    expect(
      await e.admin
        .selectFrom('archivo')
        .select('id')
        .where('id', '=', f.payload.archivo_id)
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it('CP-034 RN-08 si otro ya completó la tarea, el evento tardío es duplicado', async () => {
    const { yo: a, tareaId, asignacionId: asigA } = await tareaDescargada();
    // Se revoca A y la tarea pasa al cuaderno de B (RN-07), que la descarga y completa.
    await e.admin
      .updateTable('asignacion')
      .set({ estado: 'revocada', motivo_revocacion: 'Reasignada' })
      .where('id', '=', asigA)
      .execute();
    const b = await especialistaEnCampo(e, esc);
    await e.admin
      .updateTable('tarea')
      .set({ estado: 'asignada', cuaderno_id: b.cuadernoId })
      .where('id', '=', tareaId)
      .execute();
    const asigB =
      (await descargar(e, b.token, [tareaId])).json<{ asignaciones: { asignacion_id: string }[] }>()
        .asignaciones[0]?.asignacion_id ?? '';
    const fb = foto(tareaId, asigB);
    await enviarLote(e, b.token, [fb, completar(tareaId, asigB, [fb.payload.archivo_id])]);

    const fa = foto(tareaId, asigA);
    const r = await enviarLote(e, a.token, [
      fa,
      completar(tareaId, asigA, [fa.payload.archivo_id]),
    ]);
    expect(resultados(r).map((x) => x.estado)).toEqual(['duplicado', 'duplicado']);
    expect(await estadoTarea(tareaId)).toBe('en_transito');
  });

  it('RN-13 CP-038 la evidencia tardía sobre una tarea cerrada se guarda sin reabrirla', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    await e.admin
      .updateTable('tarea')
      .set({ estado: 'cerrada' })
      .where('id', '=', tareaId)
      .execute();
    const f = foto(tareaId, asignacionId);
    const r = await enviarLote(e, yo.token, [
      f,
      completar(tareaId, asignacionId, [f.payload.archivo_id]),
    ]);
    expect(resultados(r).map((x) => [x.estado, x.motivo])).toEqual([
      ['aplicado', undefined],
      ['no_aplicado', 'TAREA_CERRADA'],
    ]);
    expect(await estadoTarea(tareaId)).toBe('cerrada');
  });

  it('un evento con formato inválido se guarda como no aplicado sin trabar el lote', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    const roto = { ...completar(tareaId, asignacionId, []), payload: { tarea_id: 'x' } };
    const bueno = foto(tareaId, asignacionId);
    const r = await enviarLote(e, yo.token, [roto, bueno]);
    expect(resultados(r).map((x) => [x.estado, x.motivo])).toEqual([
      ['no_aplicado', 'ESQUEMA_INVALIDO'],
      ['aplicado', undefined],
    ]);
  });

  it('un lote con un id que no es UUID v7 se rechaza completo', async () => {
    const { yo } = await tareaDescargada();
    const r = await enviarLote(e, yo.token, [{ id: '3b241101-e2bb-4255-8caf-4136c566a962' }]);
    expect(r.statusCode).toBe(400);
  });

  it('los eventos aún no implementados se conservan completos', async () => {
    const { yo } = await tareaDescargada();
    const ev = sobre(
      'transecto_finalizado',
      { tipo: 'estacion_metodologia', id: esc.estacionMetodologiaId },
      {
        estacion_metodologia_id: esc.estacionMetodologiaId,
        inicio: '2026-11-10T10:00:00Z',
        fin: '2026-11-10T11:00:00Z',
        puntos: [
          { lat: -12, lon: -77, altitud_m: null, precision_m: 5, hora: '2026-11-10T10:00:00Z' },
        ],
      },
      null,
    );
    const r = await enviarLote(e, yo.token, [ev]);
    expect(resultados(r)[0]).toMatchObject({ estado: 'no_aplicado', motivo: 'NO_IMPLEMENTADO' });
    const fila = await e.admin
      .selectFrom('evento')
      .select('payload')
      .where('id', '=', ev.id)
      .executeTakeFirstOrThrow();
    expect(fila.payload).toEqual(ev.payload);
  });

  it('RN-09 la hora del servidor la asigna la API; la del dispositivo se guarda como dato', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    const antes = Date.now();
    const f = foto(tareaId, asignacionId);
    await enviarLote(e, yo.token, [f]);
    const fila = await e.admin
      .selectFrom('evento')
      .select(['hora_servidor', 'hora_dispositivo', 'ubicacion'])
      .where('id', '=', f.id)
      .executeTakeFirstOrThrow();
    expect(fila.hora_servidor.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(fila.hora_dispositivo?.toISOString()).toBe(new Date(HORA).toISOString());
    expect(fila.ubicacion).toEqual(UBICACION);
  });
});

describe('esfuerzo y jornada', () => {
  const esfuerzo = (cantidad: number) =>
    sobre(
      'esfuerzo_registrado',
      { tipo: 'estacion_metodologia', id: esc.estacionMetodologiaId },
      {
        estacion_metodologia_id: esc.estacionMetodologiaId,
        fase: 'nocturna',
        cantidad,
        fecha: '2026-11-10',
      },
      null,
    );

  it('RN-19 CP-016 dos especialistas suman su esfuerzo en la misma metodología sin sobrescribirse', async () => {
    const uno = await tareaDescargada();
    const dos = await tareaDescargada();
    const antes = await e.admin
      .selectFrom('registro_esfuerzo')
      .select((eb) => eb.fn.sum<string>('cantidad').as('total'))
      .where('estacion_metodologia_id', '=', esc.estacionMetodologiaId)
      .executeTakeFirstOrThrow();
    await enviarLote(e, uno.yo.token, [esfuerzo(10)]);
    await enviarLote(e, dos.yo.token, [esfuerzo(5)]);
    const despues = await e.admin
      .selectFrom('registro_esfuerzo')
      .select((eb) => eb.fn.sum<string>('cantidad').as('total'))
      .where('estacion_metodologia_id', '=', esc.estacionMetodologiaId)
      .executeTakeFirstOrThrow();
    expect(Number(despues.total) - Number(antes.total)).toBe(15);
  });

  it('SEG-01 no se registra esfuerzo en una metodología sin tarea propia', async () => {
    const yo = await especialistaEnCampo(e, esc);
    const r = await enviarLote(e, yo.token, [esfuerzo(3)]);
    expect(resultados(r)[0]).toMatchObject({ estado: 'no_aplicado', motivo: 'METODOLOGIA_AJENA' });
  });

  it('RN-23 abre y cierra la jornada; cerrar dos veces no la cambia', async () => {
    const yo = await especialistaEnCampo(e, esc);
    const jornada = { tipo: 'jornada', id: generarId() };
    const abrir = {
      ...sobre('jornada_iniciada', jornada, {}, null),
      hora_dispositivo: '2026-11-10T06:00:00-05:00',
    };
    const cerrar = {
      ...sobre('jornada_cerrada', jornada, { automatica: true }, null),
      hora_dispositivo: '2026-11-10T18:00:00-05:00',
    };
    const r = await enviarLote(e, yo.token, [abrir, cerrar, { ...cerrar, id: generarId() }]);
    expect(resultados(r).map((x) => x.estado)).toEqual(['aplicado', 'aplicado', 'ya_aplicado']);
    const j = await e.admin
      .selectFrom('jornada')
      .select(['cierre_automatico', 'cerrada_en'])
      .where('id', '=', jornada.id)
      .executeTakeFirstOrThrow();
    expect(j).toEqual({ cierre_automatico: true, cerrada_en: new Date('2026-11-10T23:00:00Z') });
  });
});

describe('bajada incremental (doc. 03 §9.4)', () => {
  const cambios = (token: string, desde?: string) =>
    e.app.inject({
      method: 'GET',
      url: `/api/v1/sync/cambios${desde === undefined ? '' : `?desde=${encodeURIComponent(desde)}`}`,
      headers: conToken(token),
    });

  type Cambios = {
    cambios: { entidad: string; id: string; operacion: string; datos: Record<string, unknown> }[];
    cursor: string;
  };

  it('CP-006 una tarea asignada llega como disponible', async () => {
    const yo = await especialistaEnCampo(e, esc);
    const tareaId = await nuevaTarea(e, esc, yo.cuadernoId);
    const r = (await cambios(yo.token)).json<Cambios>();
    expect(r.cambios).toContainEqual(
      expect.objectContaining({ entidad: 'tarea', id: tareaId, operacion: 'disponible' }),
    );
  });

  it('RN-07 la revocación llega al celular con su motivo', async () => {
    const { yo, tareaId, asignacionId } = await tareaDescargada();
    await e.admin
      .updateTable('asignacion')
      .set({ estado: 'revocada', motivo_revocacion: 'Cambio de zona' })
      .where('id', '=', asignacionId)
      .execute();
    const r = (await cambios(yo.token)).json<Cambios>();
    expect(r.cambios).toContainEqual({
      entidad: 'tarea',
      id: tareaId,
      operacion: 'revocada',
      datos: { asignacion_id: asignacionId, motivo: 'Cambio de zona' },
    });
  });

  it('RF-M17 CP-041 la orden de baja llega en la bajada', async () => {
    const yo = await especialistaEnCampo(e, esc);
    await e.admin
      .updateTable('dispositivo')
      .set({ estado: 'baja_pendiente' })
      .where('id', '=', yo.dispositivoId)
      .execute();
    const r = (await cambios(yo.token)).json<Cambios>();
    expect(r.cambios).toContainEqual({
      entidad: 'dispositivo',
      id: yo.dispositivoId,
      operacion: 'baja',
      datos: {},
    });
  });

  it('con el cursor solo llegan los cambios posteriores (salvo el margen de seguridad)', async () => {
    const yo = await especialistaEnCampo(e, esc);
    const primera = await nuevaTarea(e, esc, yo.cuadernoId);
    const { cursor } = (await cambios(yo.token)).json<Cambios>();
    // Se lleva la primera tarea fuera del margen de 30 s (sin el trigger que renueva la fecha).
    await sql`ALTER TABLE app.tarea DISABLE TRIGGER tarea_actualizado_en`.execute(e.admin);
    try {
      await e.admin
        .updateTable('tarea')
        .set({ actualizado_en: new Date(Date.now() - 120_000) })
        .where('id', '=', primera)
        .execute();
    } finally {
      await sql`ALTER TABLE app.tarea ENABLE TRIGGER tarea_actualizado_en`.execute(e.admin);
    }
    const segunda = await nuevaTarea(e, esc, yo.cuadernoId);
    const ids = (await cambios(yo.token, cursor)).json<Cambios>().cambios.map((c) => c.id);
    expect(ids).toContain(segunda);
    expect(ids).not.toContain(primera);
  });

  it('un cursor inválido responde 400', async () => {
    const yo = await especialistaEnCampo(e, esc);
    expect((await cambios(yo.token, 'no-es-un-cursor')).statusCode).toBe(400);
  });
});
