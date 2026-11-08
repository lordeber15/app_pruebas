import { diasEntre } from '@campo/core';
import { leerSemillaA01 } from '@campo/db/toce';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  conToken,
  iniciarEntorno,
  lote,
  organizacion,
  pedir,
  usuarioConDispositivo,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

/**
 * Armar el trabajo desde la web como Coordinación y JdP (RF-W09, RF-W12, RN-28, RN-29, RN-35,
 * RN-36): fechas de la demo, estaciones nuevas, cronograma base armado en la web, asignar
 * estaciones a brigadas y avance por estación. Termina en el celular: el paquete de campo de la
 * brigada trae sus reservas.
 */
let e: Entorno;
let o: Organizacion;

interface Resumen {
  estaciones: number;
  metodos: number;
  reservas: number;
  a01: boolean;
  fechas_corridas_dias: number | null;
  cronograma_base_existente: boolean;
  cronograma_desde: string | null;
  cronograma_hasta: string | null;
}

interface Paquete {
  cronograma: { brigada_id: string; fecha: string; estacion_id: string | null }[];
  estaciones: { id: string; codigo: string }[];
  reservas: {
    id: string;
    estacion_id: string;
    metodo_id: string;
    brigada_id: string;
    fecha_programada: string | null;
  }[];
}

interface EstacionAvance {
  id: string;
  codigo: string;
  lat: number;
  lon: number;
  brigada_id: string | null;
  fecha_programada: string | null;
  reprogramada: boolean;
  avance: { completos: number; aplicables: number; porcentaje: number | null; estado: string };
  metodos: {
    metodo_id: string;
    porcentaje: number | null;
    completo: boolean;
    ejecuciones: number;
  }[];
}

const paquete = async (token: string) => {
  const r = await e.app.inject({
    method: 'GET',
    url: '/api/v1/paquete/campo',
    headers: conToken(token),
  });
  expect(r.statusCode).toBe(200);
  return r.json<Paquete>();
};

const estacionWeb = (codigo: string, extra: object = {}) => ({
  codigo,
  zona_utm: '18S',
  este: 450_000,
  norte: 8_900_000,
  aid_aii: 'AID',
  uv: 'Pajonal de puna',
  za_ef: null,
  region: 'SIERRA',
  ...extra,
});

const nuevoProyecto = async (nombre: string): Promise<string> => {
  const r = await pedir(e, o.coordinacion.token, 'POST', '/proyectos', {
    nombre,
    validacion_activa: false,
  });
  expect(r.statusCode).toBe(201);
  return r.json<{ id: string }>().id;
};

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
}, 240_000);
afterAll(async () => {
  await e.cerrar();
});

describe('demo con fechas cercanas: carga de A01 con fecha de inicio', () => {
  it('RN-35 corre todas las fechas de A01 al crear el base; volver a cargar no corre un base existente', async () => {
    const proyectoId = await nuevoProyecto('TOCE demo con fechas');
    const ruta = `/proyectos/${proyectoId}/configuracion/toce`;
    const a01 = await leerSemillaA01();
    const fechas = a01.programacion.map((p) => p.fecha).sort();
    const primera = fechas[0] ?? '';
    const ultima = fechas.at(-1) ?? '';

    const r = await pedir(e, o.coordinacion.token, 'POST', ruta, { fecha_inicio: '2026-11-09' });
    expect(r.statusCode).toBe(200);
    const resumen = r.json<{ resumen: Resumen }>().resumen;
    expect(resumen.fechas_corridas_dias).toBe(diasEntre(primera, '2026-11-09'));
    expect(resumen.cronograma_base_existente).toBe(false);
    expect(resumen.cronograma_desde).toBe('2026-11-09');
    // Conserva el orden y los huecos: la duración es la misma.
    expect(diasEntre(resumen.cronograma_desde ?? '', resumen.cronograma_hasta ?? '')).toBe(
      diasEntre(primera, ultima),
    );
    const campania = await e.admin
      .selectFrom('campania')
      .select(['fecha_inicio'])
      .where('proyecto_id', '=', proyectoId)
      .executeTakeFirstOrThrow();
    expect(new Date(campania.fecha_inicio ?? '').toISOString().slice(0, 10)).toBe('2026-11-09');
    const reservas = await e.admin
      .selectFrom('reserva')
      .select((eb) => eb.fn.min('fecha_programada').as('min'))
      .where('proyecto_id', '=', proyectoId)
      .executeTakeFirstOrThrow();
    expect(new Date(reservas.min as string | Date).toISOString().slice(0, 10) >= '2026-11-09').toBe(
      true,
    );

    // El base ya existe: otra fecha no lo reescribe (y la respuesta lo dice).
    const otra = await pedir(e, o.jefeProyecto.token, 'POST', ruta, { fecha_inicio: '2027-03-01' });
    const r2 = otra.json<{ resumen: Resumen }>().resumen;
    expect(r2.fechas_corridas_dias).toBeNull();
    expect(r2.cronograma_base_existente).toBe(true);
    expect(r2.cronograma_desde).toBe('2026-11-09');
  }, 240_000);

  it('una fecha de inicio mal formada da 400', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${o.esc.proyectoId}/configuracion/toce`,
      { fecha_inicio: '09/11/2026' },
    );
    expect(r.statusCode).toBe(400);
  });
});

describe('armar el trabajo desde la web: estaciones, cronograma base y asignaciones', () => {
  let proyectoId: string;
  let brigadaA: string;
  let brigadaB: string;
  let est1: string;
  let est2: string;
  let metodos1: number;
  let campo: Awaited<ReturnType<typeof usuarioConDispositivo>>;

  beforeAll(async () => {
    proyectoId = await nuevoProyecto('Proyecto armado en la web');
    // Solo D01: el proyecto no usa la programación de A01.
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${proyectoId}/configuracion/toce`,
      { incluir_a01: false },
    );
    expect(r.statusCode).toBe(200);
    const resumen = r.json<{ resumen: Resumen }>().resumen;
    expect(resumen).toMatchObject({ a01: false, metodos: 33, estaciones: 0 });

    brigadaA = (
      await pedir(e, o.coordinacion.token, 'POST', `/proyectos/${proyectoId}/brigadas`, {
        nombre: 'Brigada Web A',
      })
    ).json<{ id: string }>().id;
    brigadaB = (
      await pedir(e, o.coordinacion.token, 'POST', `/proyectos/${proyectoId}/brigadas`, {
        nombre: 'Brigada Web B',
      })
    ).json<{ id: string }>().id;
    campo = await usuarioConDispositivo(e);
    const m = await pedir(e, o.coordinacion.token, 'POST', `/brigadas/${brigadaA}/miembros`, {
      usuario_id: campo.usuario.id,
      rol: 'especialista',
    });
    expect(m.statusCode).toBe(201);
  }, 240_000);

  it('RN-29 Coordinación crea una estación: UTM → EPSG:4326 en PostGIS, matriz y reservas', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${proyectoId}/estaciones`,
      estacionWeb('WEB-01'),
    );
    expect(r.statusCode).toBe(201);
    const c = r.json<{
      id: string;
      metodos_habilitados: number;
      reservas_creadas: number;
      reservas_programadas: number;
    }>();
    est1 = c.id;
    metodos1 = c.metodos_habilitados;
    expect(metodos1).toBeGreaterThan(0);
    expect(c.reservas_creadas).toBe(metodos1);
    // Aún no hay cronograma: las reservas esperan su brigada y fecha.
    expect(c.reservas_programadas).toBe(0);

    const lista = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${proyectoId}/estaciones`)
    ).json<{
      estaciones: { id: string; zona_utm: string; lat: number; lon: number; region: string }[];
    }>().estaciones;
    const s = lista.find((x) => x.id === est1);
    expect(s?.zona_utm).toBe('18 S');
    expect(s?.region).toBe('SIERRA');
    // 18 S, 450 000 E, 8 900 000 N ≈ 9,95° S, 75,46° O.
    expect(s?.lat).toBeGreaterThan(-10.1);
    expect(s?.lat).toBeLessThan(-9.8);
    expect(s?.lon).toBeGreaterThan(-75.6);
    expect(s?.lon).toBeLessThan(-75.3);

    // RN-28: los TODAS quedan habilitados; los EVENTO no generan reserva.
    const eventos = await e.admin
      .selectFrom('reserva as r')
      .innerJoin('metodo as m', 'm.id', 'r.metodo_id')
      .select('r.id')
      .where('r.estacion_id', '=', est1)
      .where('m.clase', 'in', ['evento', 'atributo'])
      .execute();
    expect(eventos).toHaveLength(0);
  });

  it('el código de estación es único en el proyecto (409) y los datos se validan (400)', async () => {
    const ruta = `/proyectos/${proyectoId}/estaciones`;
    expect(
      (await pedir(e, o.jefeProyecto.token, 'POST', ruta, estacionWeb('WEB-01'))).statusCode,
    ).toBe(409);
    expect(
      (
        await pedir(
          e,
          o.coordinacion.token,
          'POST',
          ruta,
          estacionWeb('WEB-X', { zona_utm: '99S' }),
        )
      ).statusCode,
    ).toBe(400);
  });

  it('crear o corregir estaciones: especialista, supervisor, JdB y Admin reciben 403; lo inexistente, 404', async () => {
    const ruta = `/proyectos/${proyectoId}/estaciones`;
    for (const p of [o.especialista, o.supervisorA, o.jefeA, o.admin]) {
      expect((await pedir(e, p.token, 'POST', ruta, estacionWeb('WEB-NO'))).statusCode).toBe(403);
      expect(
        (await pedir(e, p.token, 'PATCH', `/estaciones/${est1}`, { uv: 'Otro' })).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await pedir(
          e,
          o.coordinacion.token,
          'POST',
          `/proyectos/${generarId()}/estaciones`,
          estacionWeb('WEB-NO'),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, o.coordinacion.token, 'PATCH', `/estaciones/${generarId()}`, { uv: 'Otro' }))
        .statusCode,
    ).toBe(404);
  });

  it('borrador del cronograma base: solo Coordinación y JdP; filas de otro proyecto se rechazan', async () => {
    const ruta = `/proyectos/${proyectoId}/cronograma/borrador`;
    const fila = {
      brigada_id: brigadaA,
      fecha: '2026-11-10',
      tipo_actividad: 'estacion',
      estacion_id: est1,
    };
    for (const p of [o.especialista, o.supervisorA, o.jefeA, o.admin]) {
      expect((await pedir(e, p.token, 'GET', ruta)).statusCode).toBe(403);
      expect((await pedir(e, p.token, 'POST', ruta, fila)).statusCode).toBe(403);
      expect((await pedir(e, p.token, 'POST', `${ruta}/publicar`)).statusCode).toBe(403);
    }
    expect(
      (await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${generarId()}/cronograma/borrador`))
        .statusCode,
    ).toBe(404);
    // Estación sin estación, brigada ajena.
    expect(
      (await pedir(e, o.coordinacion.token, 'POST', ruta, { ...fila, estacion_id: null }))
        .statusCode,
    ).toBe(400);
    expect(
      (await pedir(e, o.coordinacion.token, 'POST', ruta, { ...fila, brigada_id: o.esc.brigadaId }))
        .statusCode,
    ).toBe(400);
    // Publicar un borrador vacío no crea nada.
    expect((await pedir(e, o.coordinacion.token, 'POST', `${ruta}/publicar`)).statusCode).toBe(409);
  });

  it('RN-35 Coordinación arma y publica el base; el celular de la brigada recibe sus reservas', async () => {
    const ruta = `/proyectos/${proyectoId}/cronograma/borrador`;
    expect((await paquete(campo.token)).reservas).toHaveLength(0);

    const r1 = await pedir(e, o.coordinacion.token, 'POST', ruta, {
      brigada_id: brigadaA,
      fecha: '2026-11-10',
      tipo_actividad: 'estacion',
      estacion_id: est1,
    });
    expect(r1.statusCode).toBe(201);
    const r2 = await pedir(e, o.coordinacion.token, 'POST', ruta, {
      brigada_id: brigadaA,
      fecha: '2026-11-09',
      tipo_actividad: 'movilizacion',
      detalle: 'Lima – Huánuco',
    });
    expect(r2.statusCode).toBe(201);
    const r3 = await pedir(e, o.coordinacion.token, 'POST', ruta, {
      brigada_id: brigadaA,
      fecha: '2026-11-11',
      tipo_actividad: 'otro',
      detalle: 'Fila de prueba que se quita',
    });
    // Quitar una fila la deja descartada; no se borra.
    expect(
      (
        await pedir(
          e,
          o.coordinacion.token,
          'POST',
          `/cronograma/borrador/${r3.json<{ id: string }>().id}/descartar`,
        )
      ).statusCode,
    ).toBe(204);
    const borrador = (await pedir(e, o.coordinacion.token, 'GET', ruta)).json<{
      publicado: boolean;
      filas: { fecha: string }[];
    }>();
    expect(borrador.publicado).toBe(false);
    expect(borrador.filas.map((f) => f.fecha)).toEqual(['2026-11-09', '2026-11-10']);

    const pub = await pedir(e, o.coordinacion.token, 'POST', `${ruta}/publicar`);
    expect(pub.statusCode).toBe(201);
    expect(pub.json()).toMatchObject({ numero: 1, filas: 2, reservas_programadas: metodos1 });
    expect((await pedir(e, o.jefeProyecto.token, 'POST', `${ruta}/publicar`)).statusCode).toBe(409);
    expect(
      (
        await pedir(e, o.coordinacion.token, 'POST', ruta, {
          brigada_id: brigadaA,
          fecha: '2026-11-12',
          tipo_actividad: 'feriado',
        })
      ).statusCode,
    ).toBe(409);

    const crono = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${proyectoId}/cronograma`)
    ).json<{
      version: { numero: number; es_base: boolean };
      items: unknown[];
    }>();
    expect(crono.version).toMatchObject({ numero: 1, es_base: true });
    expect(crono.items).toHaveLength(2);

    const p = await paquete(campo.token);
    expect(p.reservas).toHaveLength(metodos1);
    expect(p.reservas.every((r) => r.estacion_id === est1 && r.brigada_id === brigadaA)).toBe(true);
    expect(p.reservas.every((r) => r.fecha_programada === '2026-11-10')).toBe(true);
    expect(p.estaciones.map((s) => s.codigo)).toEqual(['WEB-01']);
  });

  it('RN-36 asignar una estación nueva: Coordinación no aplica directo; el JdP «Aplicar ahora» deja solicitud + aprobación', async () => {
    const c = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${proyectoId}/estaciones`,
      estacionWeb('WEB-02', { este: 452_000, norte: 8_901_000 }),
    );
    est2 = c.json<{ id: string }>().id;
    const cuerpo = {
      motivo: 'Se agrega la estación WEB-02 a la brigada A.',
      cambios: [
        {
          tipo: 'agregar',
          item: {
            id: randomUUID(),
            brigada_id: brigadaA,
            fecha: '2026-11-12',
            tipo_actividad: 'estacion',
            estacion_id: est2,
            detalle: null,
            actividad_especial: null,
          },
        },
      ],
    };
    const ruta = `/proyectos/${proyectoId}/cronograma/aplicar`;
    for (const p of [o.coordinacion, o.especialista, o.jefeA, o.admin]) {
      expect((await pedir(e, p.token, 'POST', ruta, cuerpo)).statusCode).toBe(403);
    }
    expect(
      (
        await pedir(
          e,
          o.jefeProyecto.token,
          'POST',
          `/proyectos/${generarId()}/cronograma/aplicar`,
          cuerpo,
        )
      ).statusCode,
    ).toBe(404);
    const r = await pedir(e, o.jefeProyecto.token, 'POST', ruta, cuerpo);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ numero: 2 });

    const solicitudes = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${proyectoId}/cronograma/solicitudes`)
    ).json<{ solicitudes: { estado: string; decidido_por_nombre: string | null }[] }>().solicitudes;
    expect(solicitudes).toHaveLength(1);
    expect(solicitudes[0]?.estado).toBe('aprobada');

    const p = await paquete(campo.token);
    const deEst2 = p.reservas.filter((x) => x.estacion_id === est2);
    expect(deEst2.length).toBeGreaterThan(0);
    expect(
      deEst2.every((x) => x.fecha_programada === '2026-11-12' && x.brigada_id === brigadaA),
    ).toBe(true);
  });

  it('cambiar de brigada: Coordinación propone, el JdP aprueba y las reservas siguen a su fila', async () => {
    const crono = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${proyectoId}/cronograma`)
    ).json<{
      items: { id: string; estacion_id: string | null }[];
    }>();
    const fila = crono.items.find((i) => i.estacion_id === est1);
    const s = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${proyectoId}/cronograma/solicitudes`,
      {
        motivo: 'La brigada B toma WEB-01.',
        cambios: [
          { tipo: 'reprogramar', item_id: fila?.id, fecha: '2026-11-13', brigada_id: brigadaB },
        ],
      },
    );
    expect(s.statusCode).toBe(201);
    const ap = await pedir(
      e,
      o.jefeProyecto.token,
      'POST',
      `/cronograma/solicitudes/${s.json<{ id: string }>().id}/aprobar`,
    );
    expect(ap.statusCode).toBe(200);
    const p = await paquete(campo.token);
    expect(p.reservas.some((x) => x.estacion_id === est1)).toBe(false);
    expect(p.reservas.every((x) => x.estacion_id === est2)).toBe(true);
  });

  it('corregir atributos con ejecuciones sí; cambiar el código no; queda auditado', async () => {
    const p = await paquete(campo.token);
    const reserva = p.reservas.find((x) => x.estacion_id === est2);
    if (reserva === undefined) throw new Error('sin reserva');
    const ejecucionId = generarId();
    const r = await lote(e, campo.token, [
      abrir(ejecucionId, { reservaId: reserva.id, estacionId: est2, metodoId: reserva.metodo_id }),
    ]);
    expect(r[0]?.estado).toBe('aplicado');

    expect(
      (await pedir(e, o.coordinacion.token, 'PATCH', `/estaciones/${est2}`, { codigo: 'WEB-02B' }))
        .statusCode,
    ).toBe(409);
    const ok = await pedir(e, o.jefeProyecto.token, 'PATCH', `/estaciones/${est2}`, {
      uv: 'Bofedal',
      zona_utm: '18 S',
      este: 452_100,
      norte: 8_901_100,
    });
    expect(ok.statusCode).toBe(200);
    const fila = await e.admin
      .selectFrom('estacion')
      .select(['uv', 'actualizado_por', 'codigo'])
      .where('id', '=', est2)
      .executeTakeFirstOrThrow();
    expect(fila).toEqual({ uv: 'Bofedal', actualizado_por: o.jefeProyecto.id, codigo: 'WEB-02' });
    // Sin ejecuciones, el código sí se corrige.
    expect(
      (await pedir(e, o.coordinacion.token, 'PATCH', `/estaciones/${est1}`, { codigo: 'WEB-01A' }))
        .statusCode,
    ).toBe(200);
  });

  it('avance por estación: métodos completos / aplicables, con brigada, fecha y reprogramación', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${proyectoId}/estaciones/avance`,
    );
    expect(r.statusCode).toBe(200);
    const { estaciones, hoy } = r.json<{ estaciones: EstacionAvance[]; hoy: string }>();
    expect(hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(estaciones.map((s) => s.codigo)).toEqual(['WEB-01A', 'WEB-02']);
    const [uno, dos] = estaciones;
    expect(uno).toMatchObject({
      brigada_id: brigadaB,
      fecha_programada: '2026-11-13',
      reprogramada: true,
    });
    expect(uno?.avance).toMatchObject({
      completos: 0,
      aplicables: metodos1,
      porcentaje: null,
      estado: 'reprogramada',
    });
    // RN-37: con una ejecución en curso hay datos, pero ningún método completo.
    expect(dos?.avance.estado).toBe('en_curso');
    expect(dos?.avance.completos).toBe(0);
    expect(dos?.avance.porcentaje).toBe(0);
    expect(dos?.metodos.filter((m) => m.ejecuciones > 0)).toHaveLength(1);
  });

  it('avance por estación: el especialista ve solo las de su brigada; Admin y otro proyecto, 404', async () => {
    const mio = (
      await pedir(e, campo.token, 'GET', `/proyectos/${proyectoId}/estaciones/avance`)
    ).json<{
      estaciones: EstacionAvance[];
    }>();
    expect(mio.estaciones.map((s) => s.codigo)).toEqual(['WEB-02']);
    expect(
      (await pedir(e, o.admin.token, 'GET', `/proyectos/${proyectoId}/estaciones/avance`))
        .statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, o.especialista.token, 'GET', `/proyectos/${proyectoId}/estaciones/avance`))
        .statusCode,
    ).toBe(404);
    expect(
      (await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${generarId()}/estaciones/avance`))
        .statusCode,
    ).toBe(404);
  });
});

describe('fotos mínimas por ejecución (decisión del proyecto, además de D01)', () => {
  it('Coordinación y JdP la ajustan; los demás roles reciben 403; fuera de rango, 400', async () => {
    const r = await pedir(e, o.coordinacion.token, 'POST', '/proyectos', {
      nombre: 'Proyecto con fotos mínimas',
      validacion_activa: false,
      fotos_minimas_ejecucion: 3,
    });
    expect(r.statusCode).toBe(201);
    const id = r.json<{ id: string }>().id;
    const ver = async () =>
      (await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${id}`)).json<{
        fotos_minimas_ejecucion: number;
      }>().fotos_minimas_ejecucion;
    expect(await ver()).toBe(3);

    const ruta = `/proyectos/${id}`;
    expect(
      (await pedir(e, o.jefeProyecto.token, 'PATCH', ruta, { fotos_minimas_ejecucion: 0 }))
        .statusCode,
    ).toBe(204);
    expect(await ver()).toBe(0);

    for (const p of [o.especialista, o.supervisorA, o.jefeA, o.admin]) {
      expect(
        (await pedir(e, p.token, 'PATCH', ruta, { fotos_minimas_ejecucion: 5 })).statusCode,
      ).toBe(403);
    }
    for (const v of [-1, 21, 1.5]) {
      expect(
        (await pedir(e, o.coordinacion.token, 'PATCH', ruta, { fotos_minimas_ejecucion: v }))
          .statusCode,
      ).toBe(400);
    }
    expect(
      (
        await pedir(e, o.coordinacion.token, 'PATCH', `/proyectos/${generarId()}`, {
          fotos_minimas_ejecucion: 2,
        })
      ).statusCode,
    ).toBe(404);
    expect(await ver()).toBe(0);
  });
});
