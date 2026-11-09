import {
  COLUMNAS_ACTIVIDADES_ESPECIALES,
  COLUMNAS_PROGRAMACION,
  HOJA_ACTIVIDADES_ESPECIALES,
  HOJA_INSTRUCCIONES,
  HOJA_PROGRAMACION,
} from '@campo/core';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { empaquetarSinCompresion, leerEntradasZip } from '../src/plataforma/xlsx.ts';
import { generarId } from '../src/plataforma/ids.ts';
import {
  agregarMiembro,
  conToken,
  iniciarEntorno,
  nuevoEscenario,
  organizacion,
  pedir,
  persona,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

/**
 * Carga de la programación A01 desde la web (RF-W09, decisión del usuario 2026-11-08): plantilla
 * con listas, vista previa con errores por fila, aplicar al borrador o como solicitud de
 * reprogramación (RN-35, RN-36), estación nueva con conversión UTM, idempotencia, tipo por
 * contenido y el Supervisor de campo que solo sugiere para sus brigadas.
 */
let e: Entorno;
let o: Organizacion;
let codigoA: string;
let codigoB: string;
let codigoEstacion: string;

type Celda = string | number | null;

interface Vista {
  importacion_id: string;
  estado: string;
  destino: 'borrador' | 'solicitud';
  resumen: {
    filas: number;
    nuevas: number;
    cambios: number;
    sin_cambio: number;
    no_incluidas: number;
    estaciones_nuevas: number;
    errores: number;
  };
  filas: {
    hoja: string | null;
    fila: number | null;
    accion: string;
    estacion: string | null;
    brigada: string | null;
    fecha: string | null;
    detalle: string;
    errores: string[];
    avisos: string[];
  }[];
}

/** Fila de la hoja 01 (columnas de A01). */
const fila01 = (x: {
  brigada: string;
  fecha: Celda;
  tipo?: string;
  estacion?: string | null;
  zona?: string | null;
  este?: number | null;
  norte?: number | null;
  aid?: string | null;
  uv?: string | null;
  zaef?: string | null;
  detalle?: string | null;
  estado?: string;
}): Celda[] => [
  'REGULAR',
  'SIERRA',
  x.brigada,
  x.fecha,
  x.tipo ?? 'ESTACIÓN',
  x.estacion ?? null,
  x.zona ?? null,
  x.este ?? null,
  x.norte ?? null,
  x.aid ?? null,
  x.uv ?? null,
  x.zaef ?? null,
  x.detalle ?? null,
  x.estado ?? 'OK',
];

const libro = async (hoja01: Celda[][], hoja02: Celda[][] = []): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet(HOJA_PROGRAMACION);
  a.addRow([...COLUMNAS_PROGRAMACION]);
  for (const f of hoja01) a.addRow(f);
  if (hoja02.length > 0) {
    const b = wb.addWorksheet('02_Actividades_Especiales');
    b.addRow([...COLUMNAS_ACTIVIDADES_ESPECIALES]);
    for (const f of hoja02) b.addRow(f);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
};

/** El Excel va como cuerpo crudo; el nombre, en la cabecera `x-nombre-archivo`. */
const subir = (token: string, proyectoId: string, datos: Buffer, nombre = 'programacion.xlsx') =>
  e.app.inject({
    method: 'POST',
    url: `/api/v1/proyectos/${proyectoId}/programacion/importar`,
    headers: {
      ...conToken(token),
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'x-nombre-archivo': encodeURIComponent(nombre),
    },
    payload: datos,
  });

const plantilla = (token: string, proyectoId: string, conDatos: boolean) =>
  e.app.inject({
    method: 'GET',
    url: `/api/v1/proyectos/${proyectoId}/programacion/plantilla?con_datos=${conDatos ? '1' : '0'}`,
    headers: conToken(token),
  });

const leerLibro = async (cuerpo: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(cuerpo as unknown as ArrayBuffer);
  return wb;
};

const valoresLista = (wb: ExcelJS.Workbook, columna: number): string[] => {
  const ws = wb.getWorksheet('Listas');
  const out: string[] = [];
  ws?.getColumn(columna).eachCell((c, n) => {
    if (n > 1 && typeof c.value === 'string') out.push(c.value);
  });
  return out;
};

const aplicar = (token: string, id: string, extra: object = {}) =>
  pedir(e, token, 'POST', `/importaciones-programacion/${id}/aplicar`, {
    motivo: 'Programación A01 recibida del cliente',
    ...extra,
  });

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  const brigadas = await e.admin
    .selectFrom('brigada')
    .select(['id', 'codigo'])
    .where('proyecto_id', '=', o.esc.proyectoId)
    .execute();
  codigoA = brigadas.find((b) => b.id === o.esc.brigadaId)?.codigo ?? '';
  codigoB = brigadas.find((b) => b.id === o.esc.brigadaB)?.codigo ?? '';
  codigoEstacion = (
    await e.admin
      .selectFrom('estacion')
      .select('codigo')
      .where('id', '=', o.esc.estacionId)
      .executeTakeFirstOrThrow()
  ).codigo;
}, 240_000);
afterAll(async () => {
  await e.cerrar();
});

describe('RF-W09 plantilla de programación A01 descargable', () => {
  it('RF-W09 trae las hojas y encabezados de A01 con listas de valores y las brigadas del proyecto', async () => {
    const r = await plantilla(o.coordinacion.token, o.esc.proyectoId, false);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect(r.headers['content-disposition']).toMatch(
      /^attachment; filename="programacion-.+\.xlsx"$/,
    );
    const wb = await leerLibro(r.rawPayload);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      HOJA_PROGRAMACION,
      HOJA_ACTIVIDADES_ESPECIALES,
      HOJA_INSTRUCCIONES,
      'Listas',
    ]);
    expect(wb.getWorksheet('Listas')?.state).toBe('veryHidden');
    const encabezados = (wb.getWorksheet(HOJA_PROGRAMACION)?.getRow(1).values as Celda[]).slice(1);
    expect(encabezados).toEqual([...COLUMNAS_PROGRAMACION]);
    const enc02 = (wb.getWorksheet(HOJA_ACTIVIDADES_ESPECIALES)?.getRow(1).values as Celda[]).slice(
      1,
    );
    expect(enc02).toEqual([...COLUMNAS_ACTIVIDADES_ESPECIALES]);
    // Listas: tipo programación, región, actividad, brigada, tipo actividad, AID/AII, ZA/EF, estado.
    expect(valoresLista(wb, 1)).toEqual(['REGULAR', 'COMPLEMENTARIA']);
    expect(valoresLista(wb, 2)).toEqual(['COSTA', 'SIERRA', 'SELVA', 'COMPLEMENTARIA']);
    expect(valoresLista(wb, 3)).toEqual(['EPÍFITAS', 'CÁMARAS TRAMPA']);
    expect(valoresLista(wb, 4).sort()).toEqual([codigoA, codigoB].sort());
    expect(valoresLista(wb, 5)).toContain('FERIADO / NO OPERATIVO');
    expect(valoresLista(wb, 8)).toEqual([
      'OK',
      'PENDIENTE VALIDACIÓN',
      'REPROGRAMADA',
      'SUJETA A DECISIÓN',
    ]);
    // Validación de datos en la columna Brigada (C) de la hoja 01.
    const dv = Object.values(
      (
        wb.getWorksheet(HOJA_PROGRAMACION) as unknown as {
          dataValidations: {
            model: Record<string, { type: string; formulae: string[] } | undefined>;
          };
        }
      ).dataValidations.model,
    );
    expect(dv.some((v) => v?.type === 'list' && v.formulae[0] === 'Listas!$D$2:$D$3')).toBe(true);
  });

  it('RF-W09 el Supervisor de campo descarga solo sus brigadas; especialista, JdB y Admin no', async () => {
    const r = await plantilla(o.supervisorA.token, o.esc.proyectoId, false);
    expect(r.statusCode).toBe(200);
    expect(valoresLista(await leerLibro(r.rawPayload), 4)).toEqual([codigoA]);
    for (const p of [o.especialista, o.jefeA, o.admin]) {
      expect((await plantilla(p.token, o.esc.proyectoId, false)).statusCode).toBe(403);
    }
  });

  it('RF-W09 otro proyecto: el Supervisor de otra brigada no descarga ni sube', async () => {
    const otro = await nuevoEscenario(e);
    expect((await plantilla(o.supervisorA.token, otro.proyectoId, false)).statusCode).toBe(403);
    const x = await libro([
      fila01({ brigada: codigoA, fecha: '2026-12-02', estacion: codigoEstacion }),
    ]);
    expect((await subir(o.supervisorA.token, otro.proyectoId, x)).statusCode).toBe(403);
    expect((await plantilla(o.coordinacion.token, generarId(), false)).statusCode).toBe(404);
  });
});

describe('RF-W09 vista previa y aplicar (RN-35)', () => {
  it('RF-W09 archivo que no es xlsx por contenido → 415, aunque se llame .xlsx', async () => {
    const texto = await subir(
      o.coordinacion.token,
      o.esc.proyectoId,
      Buffer.from('Tipo programación;Región\nREGULAR;COSTA\n'),
      'falso.xlsx',
    );
    expect(texto.statusCode).toBe(415);
    expect(texto.json<{ codigo: string }>().codigo).toBe('ARCHIVO_NO_XLSX');
    // Un ZIP que no es un libro de Excel.
    const zip = empaquetarSinCompresion([{ nombre: 'a.txt', datos: Buffer.from('hola') }]);
    expect((await subir(o.coordinacion.token, o.esc.proyectoId, zip)).statusCode).toBe(415);
    // «Bomba zip»: el directorio central declara 60 MB descomprimidos → 413 antes de ExcelJS.
    const bomba = empaquetarSinCompresion([{ nombre: 'xl/workbook.xml', datos: Buffer.from('x') }]);
    const central = bomba.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomba.writeUInt32LE(60 * 1024 * 1024, central + 24);
    const r413 = await subir(o.coordinacion.token, o.esc.proyectoId, bomba);
    expect(r413.statusCode).toBe(413);
    expect(r413.json<{ codigo: string }>().codigo).toBe('XLSX_DEMASIADO_GRANDE');
    // Sin cuerpo .xlsx (JSON).
    const json = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${o.esc.proyectoId}/programacion/importar`,
      {
        archivo: 'x',
      },
    );
    expect(json.statusCode).toBe(415);
  });

  it('RF-W09 acepta el formato del A01 original (SpreadsheetML con prefijo «x:») y rechaza macros', async () => {
    const normal = await libro([
      fila01({ brigada: codigoA, fecha: '2026-12-02', estacion: codigoEstacion }),
    ]);
    const conPrefijo = (xml: string): string =>
      xml
        .replace(/<(\/?)(?![?!])([A-Za-z]+)(?=[\s>/])/g, '<$1x:$2')
        .replace(
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        );
    const entradas = leerEntradasZip(normal).map((x) =>
      /^xl\/(workbook|sharedStrings|styles|worksheets\/sheet\d+)\.xml$/.test(x.nombre)
        ? { nombre: x.nombre, datos: Buffer.from(conPrefijo(x.datos.toString('utf8'))) }
        : x,
    );
    expect(entradas.find((x) => x.nombre === 'xl/workbook.xml')?.datos.toString()).toContain(
      '<x:sheets>',
    );
    const r = await subir(
      o.coordinacion.token,
      o.esc.proyectoId,
      empaquetarSinCompresion(entradas),
    );
    expect(r.statusCode).toBe(201);
    expect(r.json<Vista>().resumen).toMatchObject({ filas: 1, errores: 0 });

    const conMacros = empaquetarSinCompresion([
      ...leerEntradasZip(normal),
      { nombre: 'xl/vbaProject.bin', datos: Buffer.from('macro') },
    ]);
    expect((await subir(o.coordinacion.token, o.esc.proyectoId, conMacros)).statusCode).toBe(415);
  });

  it('RF-W09 la vista previa da errores por fila en texto claro y no aplica nada', async () => {
    const x = await libro([
      fila01({ brigada: codigoA, fecha: '2026-12-02', estacion: codigoEstacion }),
      fila01({ brigada: 'NO EXISTE', fecha: '2026-12-03', estacion: codigoEstacion }),
      fila01({ brigada: codigoA, fecha: '31/02/2026', estacion: codigoEstacion }),
      fila01({ brigada: codigoA, fecha: '2026-12-04', estacion: null }),
      fila01({ brigada: codigoA, fecha: '2026-12-05', estacion: 'EST-SIN-DATOS' }),
    ]);
    const r = await subir(o.coordinacion.token, o.esc.proyectoId, x);
    expect(r.statusCode).toBe(201);
    const v = r.json<Vista>();
    expect(v.estado).toBe('pendiente');
    expect(v.destino).toBe('borrador');
    expect(v.resumen).toMatchObject({ filas: 5, nuevas: 1, errores: 4, estaciones_nuevas: 0 });
    const errores = v.filas.filter((f) => f.accion === 'error');
    expect(errores.map((f) => f.fila)).toEqual([3, 4, 5, 6]);
    expect(errores[0]?.errores).toEqual([
      'Brigada: «NO EXISTE» no existe en el proyecto. Créela antes en Brigadas.',
    ]);
    expect(errores[1]?.errores[0]).toMatch(/^Fecha TH: no es una fecha válida/);
    expect(errores[2]?.errores).toEqual([
      'Estación: una actividad de tipo ESTACIÓN indica su estación.',
    ]);
    expect(errores[3]?.errores[0]).toMatch(/^Estación nueva «EST-SIN-DATOS»: indique Zona UTM/);
    // Con errores no se aplica.
    const a = await aplicar(o.coordinacion.token, v.importacion_id);
    expect(a.statusCode).toBe(409);
    expect(a.json<{ codigo: string }>().codigo).toBe('IMPORTACION_CON_ERRORES');
    const borrador = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${o.esc.proyectoId}/cronograma/borrador`,
    );
    expect(borrador.json<{ filas: unknown[] }>().filas).toEqual([]);
  });

  it('RN-35 sin cronograma base: aplicar lleva las filas al borrador y crea la estación nueva con conversión UTM; aplicar dos veces → 409', async () => {
    const x = await libro(
      [
        fila01({
          brigada: codigoA,
          fecha: '2026-12-01',
          tipo: 'MOVILIZACIÓN',
          detalle: 'Movilización',
        }),
        fila01({ brigada: codigoA, fecha: '2026-12-02', estacion: codigoEstacion }),
        fila01({
          brigada: codigoB,
          fecha: '2026-12-03',
          estacion: 'EST-A01-NUEVA',
          zona: '18 S',
          este: 450_000,
          norte: 8_900_000,
          aid: 'AID',
          uv: 'Pajonal de puna',
          zaef: '—',
          estado: 'PENDIENTE VALIDACIÓN',
        }),
      ],
      [
        [
          'EPÍFITAS',
          codigoB,
          '2026-12-04',
          'ESTACIÓN',
          'EST-A01-NUEVA',
          '18 S',
          450_000,
          8_900_000,
          'AID',
          'Pajonal de puna',
          '—',
          null,
          'OK',
        ],
      ],
    );
    const r = await subir(o.coordinacion.token, o.esc.proyectoId, x, 'A01 parcial.xlsx');
    expect(r.statusCode).toBe(201);
    const v = r.json<Vista>();
    expect(v.resumen).toMatchObject({ nuevas: 4, cambios: 0, errores: 0, estaciones_nuevas: 1 });

    const a = await aplicar(o.coordinacion.token, v.importacion_id);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({
      destino: 'borrador',
      estaciones_creadas: 1,
      filas_agregadas: 4,
      solicitud_id: null,
    });
    const otraVez = await aplicar(o.coordinacion.token, v.importacion_id);
    expect(otraVez.statusCode).toBe(409);
    expect(otraVez.json<{ codigo: string }>().codigo).toBe('IMPORTACION_YA_PROCESADA');

    // Estación nueva: UTM 18 S (EPSG:32718) → EPSG:4326 con PostGIS; atributos conservados.
    const est = await e.admin
      .selectFrom('estacion')
      .select([
        'codigo',
        'zona_utm',
        'aid_aii',
        'za_ef',
        sql<number>`ST_X(geom)`.as('lon'),
        sql<number>`ST_Y(geom)`.as('lat'),
        sql<number>`ST_SRID(geom)`.as('srid'),
      ])
      .where('proyecto_id', '=', o.esc.proyectoId)
      .where('codigo', '=', 'EST-A01-NUEVA')
      .executeTakeFirstOrThrow();
    expect(est).toMatchObject({ zona_utm: '18 S', aid_aii: 'AID', za_ef: null, srid: 4326 });
    expect(est.lon).toBeCloseTo(-75.456, 2);
    expect(est.lat).toBeCloseTo(-9.95, 2);

    const borrador = (
      await pedir(
        e,
        o.coordinacion.token,
        'GET',
        `/proyectos/${o.esc.proyectoId}/cronograma/borrador`,
      )
    ).json<{
      filas: {
        fecha: string;
        estacion_codigo: string | null;
        estado_fila: string;
        actividad_especial: string | null;
      }[];
    }>().filas;
    expect(
      borrador.map((f) => [f.fecha, f.estacion_codigo, f.estado_fila, f.actividad_especial]),
    ).toEqual([
      ['2026-12-01', null, 'ok', null],
      ['2026-12-02', codigoEstacion, 'ok', null],
      ['2026-12-03', 'EST-A01-NUEVA', 'pendiente_validacion', null],
      ['2026-12-04', 'EST-A01-NUEVA', 'ok', 'EPÍFITAS'],
    ]);

    // Volver a subir lo mismo: todo sin cambio; aplicar no tiene nada que hacer.
    const igual = (await subir(o.coordinacion.token, o.esc.proyectoId, x)).json<Vista>();
    expect(igual.resumen).toMatchObject({
      nuevas: 0,
      cambios: 0,
      sin_cambio: 4,
      estaciones_nuevas: 0,
    });
    expect((await aplicar(o.coordinacion.token, igual.importacion_id)).statusCode).toBe(409);
  });

  it('RN-35 con cronograma base: la carga crea una solicitud de reprogramación; nada desaparece', async () => {
    const pub = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${o.esc.proyectoId}/cronograma/borrador/publicar`,
    );
    expect(pub.statusCode).toBe(201);

    // La plantilla con datos trae la programación vigente.
    const conDatos = await leerLibro(
      (await plantilla(o.coordinacion.token, o.esc.proyectoId, true)).rawPayload,
    );
    expect(conDatos.getWorksheet(HOJA_PROGRAMACION)?.rowCount).toBe(4);
    expect(conDatos.getWorksheet(HOJA_ACTIVIDADES_ESPECIALES)?.rowCount).toBe(2);

    // Solo la estación de la brigada A cambia de fecha; se agrega un traslado. La movilización y
    // la estación nueva no vienen en el archivo: se conservan («no incluida»).
    const x = await libro([
      fila01({ brigada: codigoA, fecha: '2026-12-06', estacion: codigoEstacion }),
      fila01({
        brigada: codigoB,
        fecha: '2026-12-07',
        tipo: 'TRASLADO',
        detalle: 'Traslado a Tingo María',
      }),
    ]);
    const v = (await subir(o.coordinacion.token, o.esc.proyectoId, x)).json<Vista>();
    expect(v.destino).toBe('solicitud');
    expect(v.resumen).toMatchObject({ nuevas: 1, cambios: 1, errores: 0, no_incluidas: 3 });
    expect(v.filas.find((f) => f.accion === 'cambio')?.detalle).toBe(
      'Fecha 02/12/2026 → 06/12/2026.',
    );
    expect(
      v.filas
        .filter((f) => f.accion === 'no_incluida')
        .every((f) => /nada se elimina/.test(f.detalle)),
    ).toBe(true);

    // «Aplicar ahora» es solo del JdP.
    expect(
      (await aplicar(o.coordinacion.token, v.importacion_id, { aplicar_ahora: true })).statusCode,
    ).toBe(403);
    const a = await aplicar(o.coordinacion.token, v.importacion_id);
    expect(a.statusCode).toBe(200);
    const res = a.json<{ destino: string; solicitud_id: string; version_numero: number | null }>();
    expect(res).toMatchObject({ destino: 'solicitud', version_numero: null });

    const solicitudes = (
      await pedir(
        e,
        o.jefeProyecto.token,
        'GET',
        `/proyectos/${o.esc.proyectoId}/cronograma/solicitudes`,
      )
    ).json<{
      solicitudes: {
        id: string;
        estado: string;
        cambios: { tipo: string }[];
        impacto: { items_desaparecidos: string[] };
      }[];
    }>().solicitudes;
    const s = solicitudes.find((x2) => x2.id === res.solicitud_id);
    expect(s?.estado).toBe('pendiente');
    expect(s?.cambios.map((c) => c.tipo).sort()).toEqual(['agregar', 'reprogramar']);
    expect(s?.impacto.items_desaparecidos).toEqual([]);

    // El JdP aprueba: versión 2 con todas las filas (ninguna desaparece, RN-35).
    const ap = await pedir(
      e,
      o.jefeProyecto.token,
      'POST',
      `/cronograma/solicitudes/${res.solicitud_id}/aprobar`,
    );
    expect(ap.statusCode).toBe(200);
    const crono = (
      await pedir(e, o.coordinacion.token, 'GET', `/proyectos/${o.esc.proyectoId}/cronograma`)
    ).json<{
      version: { numero: number };
      items: { fecha: string; estacion_codigo: string | null; estado_fila: string }[];
    }>();
    expect(crono.version.numero).toBe(2);
    expect(crono.items).toHaveLength(5);
    expect(crono.items.find((i) => i.estacion_codigo === codigoEstacion)).toMatchObject({
      fecha: '2026-12-06',
      estado_fila: 'reprogramada',
    });
  });

  it('RN-36 «Aplicar ahora» del JdP: solicitud + aprobación en un paso', async () => {
    const x = await libro([
      fila01({ brigada: codigoA, fecha: '2026-12-08', estacion: codigoEstacion }),
    ]);
    const v = (await subir(o.jefeProyecto.token, o.esc.proyectoId, x)).json<Vista>();
    expect(v.resumen.cambios).toBe(1);
    const a = await aplicar(o.jefeProyecto.token, v.importacion_id, { aplicar_ahora: true });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ destino: 'aplicada_ahora', version_numero: 3 });
  });
});

describe('RF-W09 Supervisor de campo: solo sugiere para sus brigadas', () => {
  it('RF-W09 no toca otra brigada (error por fila), envía la propuesta, no la aplica (403); Coordinación la aplica', async () => {
    const otraBrigada = await libro([
      fila01({ brigada: codigoB, fecha: '2026-12-09', tipo: 'TRASLADO', detalle: 'Traslado' }),
    ]);
    const vb = (await subir(o.supervisorA.token, o.esc.proyectoId, otraBrigada)).json<Vista>();
    expect(vb.resumen.errores).toBe(1);
    expect(vb.filas[0]?.errores[0]).toMatch(
      /^Brigada: solo puede sugerir la programación de sus brigadas/,
    );

    const x = await libro([
      fila01({ brigada: codigoA, fecha: '2026-12-10', estacion: codigoEstacion }),
    ]);
    const r = await subir(o.supervisorA.token, o.esc.proyectoId, x);
    expect(r.statusCode).toBe(201);
    const v = r.json<Vista>();
    // Solo compara con lo de su brigada: lo de la B no aparece como «no incluida».
    expect(
      v.filas.filter((f) => f.accion === 'no_incluida').every((f) => f.brigada === codigoA),
    ).toBe(true);
    expect((await aplicar(o.supervisorA.token, v.importacion_id)).statusCode).toBe(403);
    const pr = await pedir(
      e,
      o.supervisorA.token,
      'POST',
      `/importaciones-programacion/${v.importacion_id}/proponer`,
      {
        motivo: 'Cambio de fecha por lluvias',
      },
    );
    expect(pr.statusCode).toBe(204);

    // Otro especialista u otro supervisor no la ven.
    const otroSup = await persona(e);
    await agregarMiembro(e, o.esc.brigadaB, otroSup.id, 'supervisor_campo');
    expect(
      (await pedir(e, otroSup.token, 'GET', `/importaciones-programacion/${v.importacion_id}`))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await pedir(
          e,
          o.especialista.token,
          'GET',
          `/importaciones-programacion/${v.importacion_id}`,
        )
      ).statusCode,
    ).toBe(403);

    // Coordinación ve las propuestas, revisa la misma vista previa y la aplica.
    const lista = (
      await pedir(
        e,
        o.coordinacion.token,
        'GET',
        `/proyectos/${o.esc.proyectoId}/programacion/importaciones?estado=propuesta`,
      )
    ).json<{ importaciones: { id: string; motivo: string }[] }>().importaciones;
    expect(lista.map((i) => i.id)).toContain(v.importacion_id);
    const revisada = (
      await pedir(e, o.coordinacion.token, 'GET', `/importaciones-programacion/${v.importacion_id}`)
    ).json<Vista>();
    expect(revisada).toMatchObject({ estado: 'propuesta', resumen: { cambios: 1, errores: 0 } });
    const a = await aplicar(o.coordinacion.token, v.importacion_id);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ destino: 'solicitud' });
  });

  it('RF-W09 Coordinación descarta una propuesta con motivo; luego no se aplica', async () => {
    const x = await libro([
      fila01({ brigada: codigoA, fecha: '2026-12-11', estacion: codigoEstacion }),
    ]);
    const v = (await subir(o.supervisorA.token, o.esc.proyectoId, x)).json<Vista>();
    await pedir(
      e,
      o.supervisorA.token,
      'POST',
      `/importaciones-programacion/${v.importacion_id}/proponer`,
      {
        motivo: 'Sugerencia',
      },
    );
    const d = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/importaciones-programacion/${v.importacion_id}/descartar`,
      {
        motivo: 'La fecha ya se cubrió con otra brigada',
      },
    );
    expect(d.statusCode).toBe(204);
    expect((await aplicar(o.coordinacion.token, v.importacion_id)).statusCode).toBe(409);
  });

  it('RF-W09 la tabla de la web usa la misma vista previa (JSON)', async () => {
    const r = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${o.esc.proyectoId}/programacion/filas`,
      {
        filas: [
          {
            hoja: 'programacion',
            fila: 1,
            tipo_programacion: 'REGULAR',
            region: 'SIERRA',
            brigada: codigoB,
            fecha: '2026-12-12',
            tipo_actividad: 'DESMOVILIZACIÓN',
            detalle: 'Desmovilización',
            estado: 'OK',
          },
          { hoja: 'programacion', fila: 2, brigada: codigoB, fecha: 'ayer' },
        ],
      },
    );
    expect(r.statusCode).toBe(201);
    const v = r.json<Vista>();
    expect(v.resumen).toMatchObject({ nuevas: 1, errores: 1 });
    expect(
      (
        await pedir(
          e,
          o.especialista.token,
          'POST',
          `/proyectos/${o.esc.proyectoId}/programacion/filas`,
          {
            filas: [{ hoja: 'programacion', fila: 1 }],
          },
        )
      ).statusCode,
    ).toBe(403);
  });
});
