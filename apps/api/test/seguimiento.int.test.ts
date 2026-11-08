import { leerSemillaD01 } from '@campo/db/toce';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  abrir,
  ejecucionConFoto,
  enCampo,
  iniciarEntorno,
  lote,
  organizacion,
  pedir,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

/**
 * Dashboard de seguimiento (RF-W01, RN-19, RN-37, RN-38, E-09) y galería con selección manual
 * para el reporte diario (D02 §8, E-10 parcial). El método del escenario lleva la configuración
 * real de D01 «puntos de intercepción» (3 unidades; 6 en ZA/EF).
 */
let e: Entorno;
let o: Organizacion;

interface Fila {
  estacion_id: string;
  metodo_id: string;
  objetivo: { cantidad: number | null; origen: string };
  avance: { ejecutado: number; objetivo: number | null; porcentaje: number | null } | null;
  sin_datos: boolean;
  ejecuciones: number;
  por_estado: Record<string, number>;
}
interface BrigadaSeguimiento {
  id: string;
  solo_propias: boolean;
  ultima_sincronizacion: string | null;
  dispositivos: { dispositivo_id: string; ultima_sincronizacion: string }[];
  filas: Fila[];
}

const seguimiento = async (token: string, brigada?: string) => {
  const r = await pedir(
    e,
    token,
    'GET',
    `/proyectos/${o.esc.proyectoId}/seguimiento${brigada === undefined ? '' : `?brigada=${brigada}`}`,
  );
  return { status: r.statusCode, brigadas: r.json<{ brigadas: BrigadaSeguimiento[] }>().brigadas };
};

const filaA = (bs: BrigadaSeguimiento[]) =>
  bs.find((b) => b.id === o.esc.brigadaId)?.filas.find((f) => f.metodo_id === o.esc.metodoId);

const cerrarUnidades = async (ejecucionId: string, n: number) => {
  for (let i = 0; i < n; i++) {
    await e.admin
      .insertInto('unidad')
      .values({
        id: generarId(),
        ejecucion_id: ejecucionId,
        codigo: `P-${String(i + 1)}`,
        tipo_unidad: 'punto',
        estado: 'cerrada',
      })
      .execute();
  }
};

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  const d01 = await leerSemillaD01();
  const config = d01.metodos.find((m) => m.codigo === 'flora_vegetacion.puntos_intercepcion');
  await e.admin
    .updateTable('metodo')
    .set({ config: JSON.stringify(config) })
    .where('id', '=', o.esc.metodoId)
    .execute();
});
afterAll(async () => {
  await e.cerrar();
});

describe('seguimiento (RF-W01)', () => {
  it('RN-37 CA-E09: sin datos sincronizados la fila dice «sin datos», nunca 0 %, y no hay última sincronización', async () => {
    const r = await seguimiento(o.coordinacion.token);
    expect(r.status).toBe(200);
    const a = r.brigadas.find((b) => b.id === o.esc.brigadaId);
    expect(a?.ultima_sincronizacion).toBeNull();
    expect(filaA(r.brigadas)).toMatchObject({
      sin_datos: true,
      avance: null,
      ejecuciones: 0,
      objetivo: { cantidad: 3, origen: 'd01' },
    });
  });

  it('RN-38 RN-19: avance elemental = suma del esfuerzo de cada especialista / objetivo de D01', async () => {
    const uno = await enCampo(e, o.esc.brigadaId);
    const dos = await enCampo(e, o.esc.brigadaId);
    const x1 = generarId();
    const x2 = generarId();
    expect((await lote(e, uno.token, [abrir(x1, o.esc)]))[0]?.estado).toBe('aplicado');
    expect((await lote(e, dos.token, [abrir(x2, o.esc)]))[0]?.estado).toBe('aplicado');
    await cerrarUnidades(x1, 1);
    await cerrarUnidades(x2, 1);

    const r = await seguimiento(o.jefeA.token);
    const f = filaA(r.brigadas);
    expect(f).toMatchObject({
      sin_datos: false,
      ejecuciones: 2,
      por_estado: { en_curso: 2 },
      avance: { ejecutado: 2, objetivo: 3, porcentaje: 66.7 },
    });
    const a = r.brigadas.find((b) => b.id === o.esc.brigadaId);
    expect(a?.ultima_sincronizacion).not.toBeNull();
    expect(a?.dispositivos.map((d) => d.dispositivo_id).sort()).toEqual(
      [uno.dispositivoId, dos.dispositivoId].sort(),
    );
  });

  it('P-11: no hay avance agregado por brigada ni promedio', async () => {
    const r = await seguimiento(o.coordinacion.token);
    for (const b of r.brigadas) {
      expect(Object.keys(b)).not.toContain('avance');
      expect(Object.keys(b)).not.toContain('porcentaje');
    }
  });

  it('el especialista ve solo su propio esfuerzo y sus dispositivos', async () => {
    const yo = await enCampo(e, o.esc.brigadaId);
    const x = generarId();
    await lote(e, yo.token, [abrir(x, o.esc)]);
    await cerrarUnidades(x, 2);
    const r = await seguimiento(yo.token);
    expect(r.brigadas.map((b) => b.id)).toEqual([o.esc.brigadaId]);
    const a = r.brigadas[0];
    expect(a?.solo_propias).toBe(true);
    expect(a?.dispositivos.map((d) => d.dispositivo_id)).toEqual([yo.dispositivoId]);
    expect(filaA(r.brigadas)?.avance).toEqual({ ejecutado: 2, objetivo: 3, porcentaje: 66.7 });
    // Coordinación ve la suma de los tres (RN-19).
    expect(filaA((await seguimiento(o.coordinacion.token)).brigadas)?.avance?.ejecutado).toBe(4);
  });

  it('alcance: otra brigada, otro proyecto y el Administrador técnico no ven la brigada A', async () => {
    const b = await seguimiento(o.jefeB.token);
    expect(b.brigadas.map((x) => x.id)).toEqual([o.esc.brigadaB]);
    expect((await seguimiento(o.jefeB.token, o.esc.brigadaId)).status).toBe(404);
    expect((await seguimiento(o.admin.token)).status).toBe(404);
    const otra = await organizacion(e);
    expect((await seguimiento(otra.especialista.token)).status).toBe(404);
    expect(
      (await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${generarId()}/seguimiento`))
        .statusCode,
    ).toBe(404);
  });
});

// ── Galería ──────────────────────────────────────────────────────────────────

interface Foto {
  id: string;
  candidata_reporte: boolean;
  seleccionada_reporte: boolean;
  seleccion_fecha: string | null;
  estacion_codigo: string;
  puede_marcar: boolean;
}

const galeria = async (token: string, query = '') => {
  const r = await pedir(e, token, 'GET', `/proyectos/${o.esc.proyectoId}/galeria${query}`);
  return {
    status: r.statusCode,
    cuerpo: r.json<{ fotos: Foto[]; puede_seleccionar: boolean; truncado: boolean }>(),
  };
};

describe('galería y fotos del reporte diario (E-10)', () => {
  let fotoId: string;
  let sinVerificar: string;
  let duenio: Awaited<ReturnType<typeof enCampo>>;
  let companero: Awaited<ReturnType<typeof enCampo>>;

  beforeAll(async () => {
    duenio = await enCampo(e, o.esc.brigadaId);
    companero = await enCampo(e, o.esc.brigadaId);
    fotoId = (await ejecucionConFoto(e, o.esc, duenio)).archivoId;
    sinVerificar = (await ejecucionConFoto(e, o.esc, duenio)).archivoId;
    await e.admin
      .updateTable('archivo')
      .set({ estado: 'preview_verificada', candidata_reporte: false })
      .where('id', '=', fotoId)
      .execute();
  });

  it('solo muestra fotos verificadas, con el alcance de las ejecuciones', async () => {
    const coord = await galeria(o.coordinacion.token);
    expect(coord.status).toBe(200);
    expect(coord.cuerpo.fotos.map((f) => f.id)).toEqual([fotoId]);
    expect(coord.cuerpo.puede_seleccionar).toBe(true);
    expect((await galeria(duenio.token)).cuerpo.fotos.map((f) => f.id)).toEqual([fotoId]);
    expect((await galeria(o.jefeA.token)).cuerpo.fotos).toHaveLength(1);
    expect((await galeria(o.supervisorA.token)).cuerpo.puede_seleccionar).toBe(false);
    // Otro especialista de la misma brigada no ve las fotos ajenas; la brigada B tampoco.
    expect((await galeria(companero.token)).cuerpo.fotos).toHaveLength(0);
    expect((await galeria(o.jefeB.token)).cuerpo.fotos).toHaveLength(0);
    expect((await galeria(o.jefeB.token, `?brigada=${o.esc.brigadaId}`)).status).toBe(404);
    expect((await galeria(o.admin.token)).status).toBe(404);
  });

  it('filtra por estación, método y día (zona del proyecto)', async () => {
    const t = o.coordinacion.token;
    expect(
      (await galeria(t, `?estacion=${o.esc.estacionId}&metodo=${o.esc.metodoId}&fecha=2026-12-02`))
        .cuerpo.fotos,
    ).toHaveLength(1);
    expect((await galeria(t, '?fecha=2026-12-03')).cuerpo.fotos).toHaveLength(0);
    expect((await galeria(t, `?metodo=${o.esc.eventoId}`)).cuerpo.fotos).toHaveLength(0);
    expect((await galeria(t, '?seleccion=candidatas')).cuerpo.fotos).toHaveLength(0);
  });

  it('candidata: el autor, el Supervisor de su brigada y Coordinación marcan; JdB y otros no', async () => {
    const marcar = (token: string, candidata: boolean, id = fotoId) =>
      pedir(e, token, 'POST', `/archivos/${id}/candidata`, { candidata });
    expect((await marcar(duenio.token, true)).statusCode).toBe(204);
    expect(
      (await galeria(o.coordinacion.token, '?seleccion=candidatas')).cuerpo.fotos,
    ).toHaveLength(1);
    expect((await marcar(o.supervisorA.token, false)).statusCode).toBe(204);
    expect((await marcar(o.coordinacion.token, true)).statusCode).toBe(204);
    expect((await marcar(o.jefeA.token, true)).statusCode).toBe(403);
    expect((await marcar(companero.token, true)).statusCode).toBe(404);
    expect((await marcar(o.especialistaB.token, true)).statusCode).toBe(404);
    expect((await marcar(o.admin.token, true)).statusCode).toBe(404);
    expect((await marcar(o.coordinacion.token, true, generarId())).statusCode).toBe(404);
  });

  it('D02 §12: la selección final es manual y solo de Coordinación o JdP, con fecha del reporte', async () => {
    const seleccionar = (token: string, cuerpo: object, id = fotoId) =>
      pedir(e, token, 'POST', `/archivos/${id}/seleccion-reporte`, cuerpo);
    expect(
      (await seleccionar(duenio.token, { seleccionada: true, fecha: '2026-12-02' })).statusCode,
    ).toBe(403);
    expect(
      (await seleccionar(o.supervisorA.token, { seleccionada: true, fecha: '2026-12-02' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await seleccionar(o.jefeA.token, { seleccionada: true, fecha: '2026-12-02' })).statusCode,
    ).toBe(403);
    expect((await seleccionar(o.coordinacion.token, { seleccionada: true })).statusCode).toBe(400);
    expect(
      (
        await seleccionar(
          o.coordinacion.token,
          { seleccionada: true, fecha: '2026-12-02' },
          sinVerificar,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await seleccionar(o.jefeProyecto.token, { seleccionada: true, fecha: '2026-12-02' }))
        .statusCode,
    ).toBe(204);
    const sel = await galeria(o.coordinacion.token, '?seleccion=seleccionadas');
    expect(sel.cuerpo.fotos).toEqual([
      expect.objectContaining({
        id: fotoId,
        seleccionada_reporte: true,
        seleccion_fecha: '2026-12-02',
      }),
    ]);
    expect((await seleccionar(o.coordinacion.token, { seleccionada: false })).statusCode).toBe(204);
    expect(
      (await galeria(o.coordinacion.token, '?seleccion=seleccionadas')).cuerpo.fotos,
    ).toHaveLength(0);
  });

  it('la miniatura se pide con la URL firmada existente, que vuelve a autorizar', async () => {
    await e.admin
      .updateTable('archivo')
      .set({ ruta_miniatura: `proyectos/${o.esc.proyectoId}/archivos/${fotoId}/miniatura/x.webp` })
      .where('id', '=', fotoId)
      .execute();
    const ok = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/archivos/${fotoId}/url?variante=miniatura`,
    );
    expect(ok.statusCode).toBe(200);
    const no = await pedir(e, companero.token, 'GET', `/archivos/${fotoId}/url?variante=miniatura`);
    expect(no.statusCode).toBe(404);
  });

  it('un Supervisor de otra brigada no marca fotos de la brigada A', async () => {
    const sup = await enCampo(e, o.esc.brigadaB, 'supervisor_campo');
    expect(
      (await pedir(e, sup.token, 'POST', `/archivos/${fotoId}/candidata`, { candidata: true }))
        .statusCode,
    ).toBe(404);
  });
});
