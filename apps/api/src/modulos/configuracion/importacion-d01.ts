import {
  COL,
  configuracionMetodoSchema,
  diferenciasMetodo,
  HOJA_METODOS,
  leerPlantillaD01,
  type CambioCampo,
  type ConfiguracionMetodo,
  type ErrorCelda,
} from '@campo/core';
import {
  crearVersionConfiguracion,
  derivarAplicabilidad,
  sincronizarReservas,
  type Db,
} from '@campo/db';
import type { Kysely } from 'kysely';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import { exigirGlobal, noEncontrado } from '../alcance/autorizacion.ts';
import { verProyecto } from '../organizacion/servicio.ts';
import { escribirPlantillaD01, leerLibroD01 } from './excel-d01.ts';

/**
 * Carga de D01 desde la web con la plantilla Excel (RF-W09). Solo Coordinación y JdP
 * (`cargar_configuracion`). Tres pasos: descargar la plantilla (vacía o con la vigente), subirla
 * para ver la vista previa sin aplicar nada, y aplicarla con un motivo, lo que crea una versión
 * nueva de la configuración (nunca edita la usada por ejecuciones).
 */

export const TAMANO_MAXIMO = 5 * 1024 * 1024;

const comoKysely = (db: Db): Kysely<unknown> => db as unknown as Kysely<unknown>;

const especialidadesDe = (db: Db, proyectoId: string) =>
  db
    .selectFrom('especialidad')
    .select(['id', 'codigo', 'nombre'])
    .where('proyecto_id', '=', proyectoId)
    .orderBy('orden')
    .execute();

interface Vigente {
  readonly id: string;
  readonly numero: number;
  readonly metodos: readonly ConfiguracionMetodo[];
}

/** Configuración vigente del proyecto con sus métodos en orden (validados por core). */
const vigenteDe = async (db: Db, proyectoId: string): Promise<Vigente | null> => {
  const c = await db
    .selectFrom('configuracion_metodologica')
    .select(['id', 'numero'])
    .where('proyecto_id', '=', proyectoId)
    .where('estado', '=', 'vigente')
    .executeTakeFirst();
  if (c === undefined) return null;
  const filas = await db
    .selectFrom('metodo')
    .select(['codigo', 'config'])
    .where('configuracion_id', '=', c.id)
    .orderBy('orden')
    .execute();
  const metodos = filas.map((f) => {
    const r = configuracionMetodoSchema.safeParse(f.config);
    if (!r.success) {
      throw new ProblemaHttp(
        409,
        'CONFIGURACION_INVALIDA',
        `La configuración vigente del método ${f.codigo} no es válida: no se puede exportar ni comparar.`,
      );
    }
    return r.data;
  });
  return { id: c.id, numero: c.numero, metodos };
};

// ── Estado ──

export const verConfiguracionD01 = async (db: Db, actor: Actor, proyectoId: string) => {
  exigirGlobal(actor, 'cargar_configuracion');
  await verProyecto(db, actor, proyectoId);
  const vigente = await db
    .selectFrom('configuracion_metodologica as c')
    .leftJoin('usuario as u', 'u.id', 'c.creado_por')
    .select([
      'c.id',
      'c.numero',
      'c.origen',
      'c.notas',
      'c.creado_en',
      'u.nombre as creado_por_nombre',
      (eb) =>
        eb
          .selectFrom('metodo as m')
          .select((e) => e.fn.countAll<string>().as('n'))
          .whereRef('m.configuracion_id', '=', 'c.id')
          .as('metodos'),
    ])
    .where('c.proyecto_id', '=', proyectoId)
    .where('c.estado', '=', 'vigente')
    .executeTakeFirst();
  const importaciones = await db
    .selectFrom('importacion_d01 as i')
    .innerJoin('usuario as u', 'u.id', 'i.creado_por')
    .leftJoin('usuario as a', 'a.id', 'i.aplicado_por')
    .leftJoin('configuracion_metodologica as c', 'c.id', 'i.configuracion_id')
    .select([
      'i.id',
      'i.estado',
      'i.archivo_nombre',
      'i.con_errores',
      'i.creado_en',
      'u.nombre as creado_por_nombre',
      'i.aplicado_en',
      'a.nombre as aplicado_por_nombre',
      'i.motivo',
      'c.numero as version_numero',
    ])
    .where('i.proyecto_id', '=', proyectoId)
    .orderBy('i.creado_en', 'desc')
    .limit(10)
    .execute();
  return {
    vigente:
      vigente === undefined
        ? null
        : {
            numero: vigente.numero,
            origen: vigente.origen,
            notas: vigente.notas,
            creado_en: new Date(vigente.creado_en).toISOString(),
            creado_por_nombre: vigente.creado_por_nombre,
            metodos: Number(vigente.metodos ?? 0),
          },
    importaciones: importaciones.map((i) => ({
      ...i,
      creado_en: new Date(i.creado_en).toISOString(),
      aplicado_en: i.aplicado_en === null ? null : new Date(i.aplicado_en).toISOString(),
    })),
  };
};

// ── Plantilla ──

export const descargarPlantillaD01 = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  conDatos: boolean,
): Promise<{ archivo: Buffer; nombre: string }> => {
  exigirGlobal(actor, 'cargar_configuracion');
  await verProyecto(db, actor, proyectoId);
  const especialidades = await especialidadesDe(db, proyectoId);
  const vigente = conDatos ? await vigenteDe(db, proyectoId) : null;
  if (conDatos && vigente === null) {
    throw new ProblemaHttp(
      409,
      'SIN_CONFIGURACION',
      'El proyecto aún no tiene configuración D01: descargue la plantilla vacía.',
    );
  }
  const archivo = await escribirPlantillaD01({
    especialidades,
    vigente: vigente === null ? null : { numero: vigente.numero, metodos: vigente.metodos },
  });
  return {
    archivo,
    nombre: vigente === null ? 'D01_plantilla.xlsx' : `D01_v${String(vigente.numero)}.xlsx`,
  };
};

// ── Vista previa ──

export interface MetodoVistaPrevia {
  readonly codigo: string;
  readonly nombre: string;
  readonly fila: number;
  readonly estado: 'nuevo' | 'cambiado' | 'sin_cambio';
  readonly cambios: readonly CambioCampo[];
}

export interface VistaPreviaD01 {
  readonly version_base: number | null;
  readonly resumen: {
    readonly nuevos: number;
    readonly cambiados: number;
    readonly sin_cambio: number;
    readonly no_incluidos: number;
    readonly errores: number;
  };
  readonly metodos: readonly MetodoVistaPrevia[];
  /** Métodos vigentes que el archivo no trae: se conservan sin cambios al aplicar. */
  readonly no_incluidos: readonly { readonly codigo: string; readonly nombre: string }[];
  readonly errores: readonly ErrorCelda[];
}

const vistaPreviaSchema = z.object({
  version_base: z.number().nullable(),
  resumen: z.object({
    nuevos: z.number(),
    cambiados: z.number(),
    sin_cambio: z.number(),
    no_incluidos: z.number(),
    errores: z.number(),
  }),
});

export interface Importacion extends VistaPreviaD01 {
  readonly id: string;
  readonly estado: 'vista_previa' | 'aplicada';
  readonly archivo_nombre: string;
  readonly con_errores: boolean;
  /** Se puede aplicar: sin errores, con algún cambio y contra la versión que sigue vigente. */
  readonly aplicable: boolean;
  readonly creado_en: string;
}

export const previsualizarImportacionD01 = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  archivo: { readonly nombre: string; readonly datos: Buffer },
): Promise<Importacion> => {
  exigirGlobal(actor, 'cargar_configuracion');
  await verProyecto(db, actor, proyectoId);
  if (archivo.datos.length === 0) {
    throw new ProblemaHttp(400, 'ARCHIVO_VACIO', 'Adjunte el archivo de la plantilla D01.');
  }
  if (archivo.datos.length > TAMANO_MAXIMO) {
    throw new ProblemaHttp(413, 'ARCHIVO_GRANDE', 'El archivo supera los 5 MB permitidos.');
  }
  const libro = await leerLibroD01(archivo.datos);
  const especialidades = await especialidadesDe(db, proyectoId);
  const vigente = await vigenteDe(db, proyectoId);
  const porCodigo = new Map((vigente?.metodos ?? []).map((m) => [m.codigo, m]));

  const enArchivo = new Set(
    libro.metodos.flatMap((f) => {
      const c = f.celdas[COL.codigo];
      return typeof c === 'string' ? [c.trim()] : [];
    }),
  );
  const conocidos = new Set([...porCodigo.keys()].filter((c) => !enArchivo.has(c)));
  const lectura = leerPlantillaD01(libro, especialidades, conocidos);
  const errores: ErrorCelda[] = [...lectura.errores];
  if (libro.metodos.length === 0) {
    errores.unshift({
      hoja: HOJA_METODOS,
      fila: null,
      columna: null,
      mensaje: 'La hoja no tiene métodos.',
    });
  }
  if (especialidades.length === 0) {
    errores.unshift({
      hoja: HOJA_METODOS,
      fila: null,
      columna: null,
      mensaje: 'El proyecto aún no tiene especialidades: cargue primero la configuración TOCE.',
    });
  }

  const metodos: MetodoVistaPrevia[] = lectura.metodos.map(({ fila, config }) => {
    const antes = porCodigo.get(config.codigo);
    const cambios = antes === undefined ? [] : diferenciasMetodo(antes, config);
    return {
      codigo: config.codigo,
      nombre: config.nombre,
      fila,
      estado: antes === undefined ? 'nuevo' : cambios.length === 0 ? 'sin_cambio' : 'cambiado',
      cambios,
    };
  });
  const noIncluidos = (vigente?.metodos ?? [])
    .filter((m) => !enArchivo.has(m.codigo))
    .map((m) => ({ codigo: m.codigo, nombre: m.nombre }));
  const conErrores = errores.length > 0;
  const vista: VistaPreviaD01 = {
    version_base: vigente?.numero ?? null,
    resumen: {
      nuevos: metodos.filter((m) => m.estado === 'nuevo').length,
      cambiados: metodos.filter((m) => m.estado === 'cambiado').length,
      sin_cambio: metodos.filter((m) => m.estado === 'sin_cambio').length,
      no_incluidos: noIncluidos.length,
      errores: errores.length,
    },
    metodos,
    no_incluidos: noIncluidos,
    errores,
  };
  // Lo que se aplicaría: los del archivo en su orden y, después, los vigentes que no trae.
  const resultado = conErrores
    ? []
    : [
        ...lectura.metodos.map((m) => m.config),
        ...(vigente?.metodos ?? []).filter((m) => !enArchivo.has(m.codigo)),
      ];

  const id = generarId();
  const creado = await db
    .insertInto('importacion_d01')
    .values({
      id,
      proyecto_id: proyectoId,
      archivo_nombre: archivo.nombre,
      archivo_sha256: createHash('sha256').update(archivo.datos).digest('hex'),
      archivo_bytes: archivo.datos.length,
      archivo: archivo.datos,
      configuracion_base_id: vigente?.id ?? null,
      metodos: JSON.stringify(resultado),
      vista_previa: JSON.stringify(vista),
      con_errores: conErrores,
      creado_por: actor.usuarioId,
      actualizado_por: actor.usuarioId,
    })
    .returning(['creado_en'])
    .executeTakeFirstOrThrow();
  return {
    id,
    estado: 'vista_previa',
    archivo_nombre: archivo.nombre,
    con_errores: conErrores,
    aplicable: !conErrores && vista.resumen.nuevos + vista.resumen.cambiados > 0,
    creado_en: new Date(creado.creado_en).toISOString(),
    ...vista,
  };
};

/** Importación con el proyecto ya autorizado (otro proyecto o inexistente: 404). */
const buscarImportacion = async (db: Db, actor: Actor, id: string, bloquear: boolean) => {
  const imp = await db
    .selectFrom('importacion_d01')
    .select([
      'id',
      'proyecto_id',
      'estado',
      'archivo_nombre',
      'archivo_sha256',
      'con_errores',
      'configuracion_base_id',
      'metodos',
      'vista_previa',
      'creado_en',
    ])
    .where('id', '=', id)
    .$if(bloquear, (q) => q.forUpdate())
    .executeTakeFirst();
  if (imp === undefined) throw noEncontrado('La importación');
  try {
    await verProyecto(db, actor, imp.proyecto_id);
  } catch {
    throw noEncontrado('La importación');
  }
  return imp;
};

export const verImportacionD01 = async (db: Db, actor: Actor, id: string): Promise<Importacion> => {
  exigirGlobal(actor, 'cargar_configuracion');
  const imp = await buscarImportacion(db, actor, id, false);
  const vista = imp.vista_previa as unknown as VistaPreviaD01;
  const vigente = await db
    .selectFrom('configuracion_metodologica')
    .select('id')
    .where('proyecto_id', '=', imp.proyecto_id)
    .where('estado', '=', 'vigente')
    .executeTakeFirst();
  const resumen = vistaPreviaSchema.parse(vista).resumen;
  return {
    ...vista,
    id: imp.id,
    estado: imp.estado === 'aplicada' ? 'aplicada' : 'vista_previa',
    archivo_nombre: imp.archivo_nombre,
    con_errores: imp.con_errores,
    aplicable:
      imp.estado === 'vista_previa' &&
      !imp.con_errores &&
      (vigente?.id ?? null) === imp.configuracion_base_id &&
      resumen.nuevos + resumen.cambiados > 0,
    creado_en: new Date(imp.creado_en).toISOString(),
  };
};

// ── Aplicar ──

export interface ResultadoAplicacion {
  readonly configuracion_numero: number;
  readonly metodos: number;
  readonly estacion_metodo: number;
  readonly estacion_metodo_pendientes: number;
  readonly nominales_trasladadas: number;
  readonly reservas_trasladadas: number;
  readonly reservas_creadas: number;
}

export const aplicarImportacionD01 = async (
  db: Db,
  actor: Actor,
  id: string,
  motivo: string,
): Promise<ResultadoAplicacion> => {
  exigirGlobal(actor, 'cargar_configuracion');
  return db.transaction().execute(async (tx) => {
    const imp = await buscarImportacion(tx, actor, id, true);
    if (imp.estado === 'aplicada') {
      throw new ProblemaHttp(409, 'IMPORTACION_APLICADA', 'Esta importación ya se aplicó.');
    }
    if (imp.con_errores) {
      throw new ProblemaHttp(
        409,
        'IMPORTACION_CON_ERRORES',
        'La vista previa tiene errores: corrija el archivo y vuelva a subirlo.',
      );
    }
    const vigente = await tx
      .selectFrom('configuracion_metodologica')
      .select('id')
      .where('proyecto_id', '=', imp.proyecto_id)
      .where('estado', '=', 'vigente')
      .forUpdate()
      .executeTakeFirst();
    if ((vigente?.id ?? null) !== imp.configuracion_base_id) {
      throw new ProblemaHttp(
        409,
        'IMPORTACION_DESACTUALIZADA',
        'La configuración vigente cambió después de esta vista previa: vuelva a subir el archivo.',
      );
    }
    const { resumen } = vistaPreviaSchema.parse(imp.vista_previa);
    if (resumen.nuevos + resumen.cambiados === 0) {
      throw new ProblemaHttp(
        409,
        'SIN_CAMBIOS',
        'El archivo no cambia la configuración vigente: no hay nada que aplicar.',
      );
    }
    const metodos = z.array(configuracionMetodoSchema).parse(imp.metodos);
    const especialidades = await especialidadesDe(tx, imp.proyecto_id);
    const k = comoKysely(tx);
    const version = await crearVersionConfiguracion(k, {
      proyectoId: imp.proyecto_id,
      origen: `Plantilla D01 «${imp.archivo_nombre}» (sha256 ${imp.archivo_sha256.slice(0, 12)})`,
      notas: motivo,
      usuarioId: actor.usuarioId,
      metodos,
      especialidadIds: new Map(especialidades.map((e) => [e.codigo, e.id])),
    });
    // Matriz estación–método con la versión nueva (las decisiones nominales ya se trasladaron y
    // la rederivación no las pisa) y reservas faltantes, sin borrar ninguna.
    const matriz = await derivarAplicabilidad(k, {
      proyectoId: imp.proyecto_id,
      usuarioId: actor.usuarioId,
    });
    const reservas = await sincronizarReservas(k, {
      proyectoId: imp.proyecto_id,
      usuarioId: actor.usuarioId,
    });
    await tx
      .updateTable('importacion_d01')
      .set({
        estado: 'aplicada',
        configuracion_id: version.configuracionId,
        motivo,
        aplicado_en: new Date(),
        aplicado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', imp.id)
      .execute();
    return {
      configuracion_numero: version.numero,
      metodos: metodos.length,
      estacion_metodo: matriz.filas,
      estacion_metodo_pendientes: matriz.pendientes,
      nominales_trasladadas: version.nominalesTrasladadas,
      reservas_trasladadas: version.reservasTrasladadas,
      reservas_creadas: reservas.creadas,
    };
  });
};
