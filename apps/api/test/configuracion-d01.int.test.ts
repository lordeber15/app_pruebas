import { COL, COLUMNAS_D01, COLV, HOJA_METODOS, HOJA_VALIDACIONES } from '@campo/core';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import { empaquetarSinCompresion, leerEntradasZip } from '../src/plataforma/xlsx.ts';
import {
  conToken,
  iniciarEntorno,
  organizacion,
  pedir,
  type Entorno,
  type Organizacion,
} from './entorno.ts';

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const INEXISTENTE = '0196f2a0-0000-7000-8000-000000000000';

let e: Entorno;
let o: Organizacion;
let proyectoId: string;

interface Vista {
  id: string;
  estado: string;
  con_errores: boolean;
  aplicable: boolean;
  version_base: number | null;
  resumen: {
    nuevos: number;
    cambiados: number;
    sin_cambio: number;
    no_incluidos: number;
    errores: number;
  };
  metodos: {
    codigo: string;
    estado: string;
    cambios: { campo: string; antes: string; despues: string }[];
  }[];
  errores: { hoja: string; fila: number | null; columna: string | null; mensaje: string }[];
}

const subir = (token: string, proyecto: string, datos: Buffer, nombre = 'D01.xlsx') =>
  e.app.inject({
    method: 'POST',
    url: `/api/v1/proyectos/${proyecto}/configuracion/d01/importar`,
    headers: {
      ...conToken(token),
      'content-type': TIPO_XLSX,
      'x-nombre-archivo': encodeURIComponent(nombre),
    },
    payload: datos,
  });

const descargar = (token: string, proyecto: string, conDatos: '0' | '1') =>
  e.app.inject({
    method: 'GET',
    url: `/api/v1/proyectos/${proyecto}/configuracion/d01/plantilla?con_datos=${conDatos}`,
    headers: conToken(token),
  });

const libro = async (datos: Buffer): Promise<ExcelJS.Workbook> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(datos as unknown as ExcelJS.Buffer);
  return wb;
};

/** Columna de un encabezado en la fila 1. */
const columna = (ws: ExcelJS.Worksheet, encabezado: string): number => {
  let n = -1;
  ws.getRow(1).eachCell((c, i) => {
    if (c.value === encabezado) n = i;
  });
  if (n < 0) throw new Error(`Sin columna ${encabezado}`);
  return n;
};

/** Fila de la hoja de validaciones de un método y tipo. */
const filaValidacion = (ws: ExcelJS.Worksheet, codigo: string, tipo: string): ExcelJS.Row => {
  const cm = columna(ws, COLV.metodo);
  const ct = columna(ws, COLV.tipo);
  for (let r = 2; r <= ws.rowCount; r++) {
    const f = ws.getRow(r);
    if (f.getCell(cm).value === codigo && f.getCell(ct).value === tipo) return f;
  }
  throw new Error(`Sin validación ${codigo} ${tipo}`);
};

const filaMetodo = (ws: ExcelJS.Worksheet, codigo: string): ExcelJS.Row => {
  const c = columna(ws, COL.codigo);
  for (let r = 2; r <= ws.rowCount; r++)
    if (ws.getRow(r).getCell(c).value === codigo) return ws.getRow(r);
  throw new Error(`Sin método ${codigo}`);
};

/** Filas con código de método (las demás solo llevan la lista desplegable). */
const contarMetodos = (ws: ExcelJS.Worksheet): number => {
  const c = columna(ws, COL.codigo);
  let n = 0;
  for (let r = 2; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(c).value != null) n += 1;
  return n;
};

const escribir = async (wb: ExcelJS.Workbook): Promise<Buffer> =>
  Buffer.from(await wb.xlsx.writeBuffer());

beforeAll(async () => {
  e = await iniciarEntorno();
  o = await organizacion(e);
  const nuevo = await pedir(e, o.coordinacion.token, 'POST', '/proyectos', {
    nombre: 'TOCE D01 por Excel',
    validacion_activa: false,
  });
  proyectoId = nuevo.json<{ id: string }>().id;
  const carga = await pedir(
    e,
    o.coordinacion.token,
    'POST',
    `/proyectos/${proyectoId}/configuracion/toce`,
  );
  expect(carga.statusCode).toBe(200);
});
afterAll(async () => {
  await e.cerrar();
});

describe('carga de D01 por plantilla Excel (RF-W09)', () => {
  let exportado: Buffer;

  it('RF-W09: la plantilla con datos trae las hojas, los 19 encabezados de D01 y los 33 métodos', async () => {
    const r = await descargar(o.coordinacion.token, proyectoId, '1');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe(TIPO_XLSX);
    expect(String(r.headers['content-disposition'])).toContain('D01_v1.xlsx');
    exportado = r.rawPayload;
    const wb = await libro(exportado);
    const ws = wb.getWorksheet(HOJA_METODOS);
    if (ws === undefined) throw new Error('sin hoja');
    expect(wb.getWorksheet('Instrucciones')).toBeDefined();
    expect(wb.getWorksheet(HOJA_VALIDACIONES)).toBeDefined();
    const encabezados: unknown[] = [];
    ws.getRow(1).eachCell((c) => encabezados.push(c.value));
    expect(encabezados.slice(0, 19)).toEqual([...COLUMNAS_D01]);
    expect(contarMetodos(ws)).toBe(33);
    // Lista de validación en la clase de aplicabilidad.
    const clase = ws.getRow(2).getCell(columna(ws, COL.clase));
    expect(clase.dataValidation.type).toBe('list');

    const vacia = await descargar(o.jefeProyecto.token, proyectoId, '0');
    expect(vacia.statusCode).toBe(200);
    const wv = (await libro(vacia.rawPayload)).getWorksheet(HOJA_METODOS);
    if (wv === undefined) throw new Error('sin hoja');
    expect(contarMetodos(wv)).toBe(0);
  });

  it('RF-W09: exportar e importar sin cambios da 0 cambios y no se puede aplicar', async () => {
    const r = await subir(o.coordinacion.token, proyectoId, exportado);
    expect(r.statusCode).toBe(201);
    const v = r.json<Vista>();
    expect(v.errores).toEqual([]);
    expect(v.resumen).toEqual({
      nuevos: 0,
      cambiados: 0,
      sin_cambio: 33,
      no_incluidos: 0,
      errores: 0,
    });
    expect(v.aplicable).toBe(false);
    const a = await pedir(e, o.coordinacion.token, 'POST', `/importaciones-d01/${v.id}/aplicar`, {
      motivo: 'Sin cambios',
    });
    expect(a.statusCode).toBe(409);
    expect(a.json<{ codigo: string }>().codigo).toBe('SIN_CAMBIOS');
  });

  it('RF-W09: un umbral cambiado aparece en el diff; aplicar crea una versión nueva sin tocar la anterior', async () => {
    const codigo = 'flora_vegetacion.puntos_intercepcion';
    const v1 = await e.admin
      .selectFrom('metodo as m')
      .innerJoin('configuracion_metodologica as c', 'c.id', 'm.configuracion_id')
      .select(['m.id', 'm.config', 'c.id as configuracion_id'])
      .where('c.proyecto_id', '=', proyectoId)
      .where('c.estado', '=', 'vigente')
      .where('m.codigo', '=', codigo)
      .executeTakeFirstOrThrow();
    // Una ejecución abierta con la versión 1 (como si hubiera llegado del celular).
    const reserva = await e.admin
      .selectFrom('reserva')
      .select(['id', 'estacion_id', 'brigada_id'])
      .where('metodo_id', '=', v1.id)
      .orderBy('id')
      .executeTakeFirstOrThrow();
    const ejecucionId = generarId();
    await e.admin
      .insertInto('ejecucion')
      .values({
        id: ejecucionId,
        proyecto_id: proyectoId,
        reserva_id: reserva.id,
        brigada_id: reserva.brigada_id,
        estacion_id: reserva.estacion_id ?? '',
        metodo_id: v1.id,
        usuario_id: o.coordinacion.id,
        abierta_en: new Date(),
      })
      .execute();
    // Una decisión nominal en la web (RN-28, P-01) que debe sobrevivir a la versión nueva.
    const pendiente = await e.admin
      .selectFrom('estacion_metodo as em')
      .innerJoin('metodo as m', 'm.id', 'em.metodo_id')
      .innerJoin('configuracion_metodologica as c', 'c.id', 'm.configuracion_id')
      .select(['em.estacion_id', 'm.id as metodo_id', 'm.codigo'])
      .where('c.proyecto_id', '=', proyectoId)
      .where('c.estado', '=', 'vigente')
      .where('em.condicion_pendiente', '=', true)
      .orderBy('em.id')
      .executeTakeFirstOrThrow();
    const dec = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/estaciones/${pendiente.estacion_id}/metodos/${pendiente.metodo_id}/decision`,
      { decision: 'confirmar', motivo: 'Cobertura arbórea verificada' },
    );
    expect(dec.statusCode).toBe(200);
    const reservasAntes = await e.admin
      .selectFrom('reserva')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('proyecto_id', '=', proyectoId)
      .executeTakeFirstOrThrow();

    const wb = await libro(exportado);
    const ws = wb.getWorksheet(HOJA_VALIDACIONES);
    if (ws === undefined) throw new Error('sin hoja');
    filaValidacion(ws, codigo, 'separacion_minima_m').getCell(columna(ws, COLV.valor)).value = 150;
    const r = await subir(o.coordinacion.token, proyectoId, await escribir(wb), 'D01 cambio.xlsx');
    expect(r.statusCode).toBe(201);
    const v = r.json<Vista>();
    expect(v.errores).toEqual([]);
    expect(v.resumen).toMatchObject({ nuevos: 0, cambiados: 1, sin_cambio: 32, errores: 0 });
    expect(v.aplicable).toBe(true);
    expect(v.metodos.find((m) => m.codigo === codigo)?.cambios).toEqual([
      { campo: 'Validación [2 separacion_minima_m] › metros', antes: '100', despues: '150' },
    ]);
    // Ver la importación de nuevo da la misma vista previa.
    const ver = await pedir(e, o.jefeProyecto.token, 'GET', `/importaciones-d01/${v.id}`);
    expect(ver.json<Vista>().resumen.cambiados).toBe(1);

    expect(
      (await pedir(e, o.coordinacion.token, 'POST', `/importaciones-d01/${v.id}/aplicar`, {}))
        .statusCode,
    ).toBe(400);
    const a = await pedir(e, o.jefeProyecto.token, 'POST', `/importaciones-d01/${v.id}/aplicar`, {
      motivo: 'Separación mínima corregida por el cliente',
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ configuracion_numero: 2, metodos: 33, reservas_creadas: 0 });

    // La versión 1 queda histórica e intacta; la ejecución sigue apuntando a ella.
    const versiones = await e.admin
      .selectFrom('configuracion_metodologica')
      .select(['id', 'numero', 'estado', 'notas', 'creado_por'])
      .where('proyecto_id', '=', proyectoId)
      .orderBy('numero')
      .execute();
    expect(versiones.map((x) => [x.numero, x.estado])).toEqual([
      [1, 'historica'],
      [2, 'vigente'],
    ]);
    expect(versiones[1]).toMatchObject({
      notas: 'Separación mínima corregida por el cliente',
      creado_por: o.jefeProyecto.id,
    });
    const viejo = await e.admin
      .selectFrom('metodo')
      .select('config')
      .where('id', '=', v1.id)
      .executeTakeFirstOrThrow();
    expect(viejo.config).toEqual(v1.config);
    const ejec = await e.admin
      .selectFrom('ejecucion')
      .select('metodo_id')
      .where('id', '=', ejecucionId)
      .executeTakeFirstOrThrow();
    expect(ejec.metodo_id).toBe(v1.id);
    const nuevo = await sql<{ metros: number }>`
      SELECT (v->>'metros')::int AS metros
        FROM app.metodo m
        JOIN app.configuracion_metodologica c ON c.id = m.configuracion_id,
             jsonb_array_elements(m.config->'validaciones') v
       WHERE c.proyecto_id = ${proyectoId} AND c.estado = 'vigente' AND m.codigo = ${codigo}
         AND v->>'tipo' = 'separacion_minima_m'`.execute(e.admin);
    expect(nuevo.rows[0]?.metros).toBe(150);

    // Reservas: ninguna nueva ni borrada; todas apuntan a la versión vigente.
    const reservas = await sql<{ n: string; vigentes: string }>`
      SELECT count(*)::text AS n,
             count(*) FILTER (WHERE c.estado = 'vigente')::text AS vigentes
        FROM app.reserva r
        JOIN app.metodo m ON m.id = r.metodo_id
        JOIN app.configuracion_metodologica c ON c.id = m.configuracion_id
       WHERE r.proyecto_id = ${proyectoId}`.execute(e.admin);
    expect(reservas.rows[0]?.n).toBe(reservasAntes.n);
    expect(reservas.rows[0]?.vigentes).toBe(reservasAntes.n);

    // La decisión nominal sigue en la matriz de la versión nueva y el panel la muestra, con la
    // ejecución de la versión anterior contada para el mismo método.
    const panel = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/estaciones/${pendiente.estacion_id}/metodos`,
    );
    const metodosPanel = panel
      .json<{
        especialidades: {
          metodos: {
            codigo: string;
            origen: string | null;
            decision: unknown;
            ejecuciones: number;
          }[];
        }[];
      }>()
      .especialidades.flatMap((x) => x.metodos);
    expect(metodosPanel.find((m) => m.codigo === pendiente.codigo)).toMatchObject({
      origen: 'nominal',
      decision: { decision: 'confirmar' },
    });
    const panelEjec = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/estaciones/${reserva.estacion_id ?? ''}/metodos`,
    );
    const conEjec = panelEjec
      .json<{ especialidades: { metodos: { codigo: string; ejecuciones: number }[] }[] }>()
      .especialidades.flatMap((x) => x.metodos)
      .find((m) => m.codigo === codigo);
    expect(conEjec?.ejecuciones).toBe(1);

    // Auditoría: autor, motivo y archivo.
    const imp = await e.admin
      .selectFrom('importacion_d01')
      .select([
        'estado',
        'motivo',
        'aplicado_por',
        'creado_por',
        'archivo_nombre',
        'archivo_sha256',
        'archivo_bytes',
      ])
      .where('id', '=', v.id)
      .executeTakeFirstOrThrow();
    expect(imp).toMatchObject({
      estado: 'aplicada',
      motivo: 'Separación mínima corregida por el cliente',
      aplicado_por: o.jefeProyecto.id,
      creado_por: o.coordinacion.id,
      archivo_nombre: 'D01 cambio.xlsx',
    });
    expect(imp.archivo_sha256).toMatch(/^[0-9a-f]{64}$/);
    const estado = await pedir(
      e,
      o.coordinacion.token,
      'GET',
      `/proyectos/${proyectoId}/configuracion/d01`,
    );
    expect(estado.json()).toMatchObject({ vigente: { numero: 2, metodos: 33 } });

    // Aplicar dos veces: 409.
    const otra = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/importaciones-d01/${v.id}/aplicar`,
      {
        motivo: 'De nuevo',
      },
    );
    expect(otra.statusCode).toBe(409);
    expect(otra.json<{ codigo: string }>().codigo).toBe('IMPORTACION_APLICADA');

    // Subir otra vez el archivo de la versión 1 muestra el cambio inverso contra la vigente.
    const vieja = await subir(o.coordinacion.token, proyectoId, exportado);
    expect(vieja.json<Vista>().resumen.cambiados).toBe(1);
  });

  it('RF-W09: una vista previa de una versión anterior queda desactualizada', async () => {
    const r1 = await descargar(o.coordinacion.token, proyectoId, '1');
    const wb = await libro(r1.rawPayload);
    const ws = wb.getWorksheet(HOJA_VALIDACIONES);
    if (ws === undefined) throw new Error('sin hoja');
    filaValidacion(ws, 'flora_vegetacion.puntos_intercepcion', 'separacion_minima_m').getCell(
      columna(ws, COLV.valor),
    ).value = 120;
    const datos = await escribir(wb);
    const a = (await subir(o.coordinacion.token, proyectoId, datos)).json<Vista>();
    const b = (await subir(o.coordinacion.token, proyectoId, datos)).json<Vista>();
    expect(
      (
        await pedir(e, o.coordinacion.token, 'POST', `/importaciones-d01/${a.id}/aplicar`, {
          motivo: 'Primera',
        })
      ).statusCode,
    ).toBe(200);
    const r = await pedir(e, o.coordinacion.token, 'POST', `/importaciones-d01/${b.id}/aplicar`, {
      motivo: 'Segunda',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json<{ codigo: string }>().codigo).toBe('IMPORTACION_DESACTUALIZADA');
  });

  it('RF-W09: una fila inválida devuelve el error con hoja, fila y columna y no se aplica', async () => {
    const wb = await libro(exportado);
    const ws = wb.getWorksheet(HOJA_METODOS);
    const wv = wb.getWorksheet(HOJA_VALIDACIONES);
    if (ws === undefined || wv === undefined) throw new Error('sin hoja');
    const f = filaMetodo(ws, 'aves.puntos_conteo');
    f.getCell(columna(ws, COL.clase)).value = 'A VECES';
    f.getCell(columna(ws, COL.fotos_metodologicas_min)).value = 'dos';
    const fv = filaValidacion(wv, 'flora_vegetacion.puntos_intercepcion', 'separacion_minima_m');
    fv.getCell(columna(wv, COLV.control)).value = 'casi obligatorio';
    const r = await subir(o.coordinacion.token, proyectoId, await escribir(wb));
    expect(r.statusCode).toBe(201);
    const v = r.json<Vista>();
    expect(v.con_errores).toBe(true);
    expect(v.aplicable).toBe(false);
    expect(v.errores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hoja: HOJA_METODOS, fila: f.number, columna: COL.clase }),
        expect.objectContaining({
          hoja: HOJA_METODOS,
          fila: f.number,
          columna: COL.fotos_metodologicas_min,
        }),
        expect.objectContaining({
          hoja: HOJA_VALIDACIONES,
          fila: fv.number,
          columna: COLV.control,
        }),
      ]),
    );
    const a = await pedir(e, o.coordinacion.token, 'POST', `/importaciones-d01/${v.id}/aplicar`, {
      motivo: 'Con errores',
    });
    expect(a.statusCode).toBe(409);
    expect(a.json<{ codigo: string }>().codigo).toBe('IMPORTACION_CON_ERRORES');
  });

  it('RF-W09: lo que no es xlsx da 415 (por contenido, no por extensión) y un xlsx ajeno 422', async () => {
    const texto = await subir(
      o.coordinacion.token,
      proyectoId,
      Buffer.from('Grupo;Método\n'),
      'D01.xlsx',
    );
    expect(texto.statusCode).toBe(415);
    expect(texto.headers['content-type']).toContain('application/problem+json');
    const zip = await subir(
      o.coordinacion.token,
      proyectoId,
      Buffer.from('PK\x03\x04basura'),
      'D01.xlsx',
    );
    expect(zip.statusCode).toBe(415);
    // «Bomba zip»: el directorio central declara 60 MB descomprimidos → 413 antes de ExcelJS.
    const bomba = empaquetarSinCompresion([{ nombre: 'xl/workbook.xml', datos: Buffer.from('x') }]);
    const central = bomba.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomba.writeUInt32LE(60 * 1024 * 1024, central + 24);
    const r413 = await subir(o.coordinacion.token, proyectoId, bomba);
    expect(r413.statusCode).toBe(413);
    expect(r413.json<{ codigo: string }>().codigo).toBe('XLSX_DEMASIADO_GRANDE');
    // Un libro válido con macros (vbaProject.bin) → 415.
    const conMacros = empaquetarSinCompresion([
      ...leerEntradasZip(exportado),
      { nombre: 'xl/vbaProject.bin', datos: Buffer.from('macro') },
    ]);
    const r415 = await subir(o.coordinacion.token, proyectoId, conMacros);
    expect(r415.statusCode).toBe(415);
    expect(r415.json<{ codigo: string }>().codigo).toBe('ARCHIVO_NO_XLSX');
    const json = await pedir(
      e,
      o.coordinacion.token,
      'POST',
      `/proyectos/${proyectoId}/configuracion/d01/importar`,
      {
        archivo: 'x',
      },
    );
    expect(json.statusCode).toBe(415);
    const ajeno = new ExcelJS.Workbook();
    ajeno.addWorksheet('Hoja1').addRow(['a', 'b']);
    const r = await subir(o.coordinacion.token, proyectoId, await escribir(ajeno));
    expect(r.statusCode).toBe(422);
    expect(r.json<{ codigo: string }>().codigo).toBe('PLANTILLA_INVALIDA');
  });

  it('RF-W09: especialista, supervisor, jefe de brigada y admin reciben 403; otro proyecto 404', async () => {
    const imp = (await subir(o.coordinacion.token, proyectoId, exportado)).json<Vista>();
    for (const p of [o.especialista, o.supervisorA, o.jefeA, o.admin]) {
      expect((await descargar(p.token, proyectoId, '1')).statusCode).toBe(403);
      expect((await subir(p.token, proyectoId, exportado)).statusCode).toBe(403);
      expect(
        (await pedir(e, p.token, 'GET', `/proyectos/${proyectoId}/configuracion/d01`)).statusCode,
      ).toBe(403);
      expect((await pedir(e, p.token, 'GET', `/importaciones-d01/${imp.id}`)).statusCode).toBe(403);
      expect(
        (
          await pedir(e, p.token, 'POST', `/importaciones-d01/${imp.id}/aplicar`, {
            motivo: 'Intento',
          })
        ).statusCode,
      ).toBe(403);
    }
    expect((await descargar(o.coordinacion.token, INEXISTENTE, '1')).statusCode).toBe(404);
    expect((await subir(o.coordinacion.token, INEXISTENTE, exportado)).statusCode).toBe(404);
    expect(
      (
        await pedir(e, o.coordinacion.token, 'POST', `/importaciones-d01/${INEXISTENTE}/aplicar`, {
          motivo: 'Nada',
        })
      ).statusCode,
    ).toBe(404);
    // Otro proyecto sin configuración: la plantilla con datos no existe (409) y sin especialidades
    // la importación no es aplicable.
    const otro = (
      await pedir(e, o.coordinacion.token, 'POST', '/proyectos', {
        nombre: 'Otro',
        validacion_activa: false,
      })
    ).json<{ id: string }>().id;
    expect((await descargar(o.coordinacion.token, otro, '1')).statusCode).toBe(409);
    const vista = (await subir(o.coordinacion.token, otro, exportado)).json<Vista>();
    expect(vista.con_errores).toBe(true);
    expect(vista.aplicable).toBe(false);
  });
});
