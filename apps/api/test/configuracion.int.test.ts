import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarEntorno, organizacion, pedir, type Entorno, type Organizacion } from './entorno.ts';

let e: Entorno;
let o: Organizacion;

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
});
afterAll(async () => {
  await e.cerrar();
});

describe('carga de D01 y A01 desde la web (RF-W09)', () => {
  it('solo Coordinación y JdP cargan la configuración; el resto recibe 403', async () => {
    const nuevo = await pedir(e, o.coordinacion.token, 'POST', '/proyectos', {
      nombre: 'TOCE web',
      validacion_activa: false,
    });
    const proyectoId = nuevo.json<{ id: string }>().id;
    const ruta = `/proyectos/${proyectoId}/configuracion/toce`;
    for (const p of [o.admin, o.jefeA, o.supervisorA, o.especialista]) {
      expect((await pedir(e, p.token, 'POST', ruta)).statusCode).toBe(403);
    }

    const r = await pedir(e, o.coordinacion.token, 'POST', ruta);
    expect(r.statusCode).toBe(200);
    const { resumen } = r.json<{ resumen: { estaciones: number; reservas: number } }>();
    expect(resumen.estaciones).toBe(102);
    expect(resumen.reservas).toBeGreaterThan(0);

    // Idempotente: repetirla (ahora el JdP) no duplica estaciones ni reservas.
    expect((await pedir(e, o.jefeProyecto.token, 'POST', ruta)).statusCode).toBe(200);
    const reservas = await e.admin
      .selectFrom('reserva')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('proyecto_id', '=', proyectoId)
      .executeTakeFirstOrThrow();
    expect(Number(reservas.n)).toBe(resumen.reservas);
    const est = await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${proyectoId}/estaciones`);
    expect(est.json<{ estaciones: unknown[] }>().estaciones).toHaveLength(102);
  });

  it('un proyecto inexistente da 404', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      '/proyectos/0196f2a0-0000-7000-8000-000000000000/configuracion/toce',
    );
    expect(r.statusCode).toBe(404);
  });
});
