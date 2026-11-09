import { createHash } from 'node:crypto';
import {
  cambiosDeFilaComparada,
  compararProgramacion,
  esRolBrigada,
  esRolGlobal,
  estacionNuevaSchema,
  ESTADOS_FILA_CRONOGRAMA,
  ETIQUETA_ESTADO_FILA_A01,
  ETIQUETA_TIPO_ACTIVIDAD_A01,
  filaProgramacionEntradaSchema,
  nivelPermiso,
  normalizarCodigoEstacion,
  normalizarEtiqueta,
  regionDeFila,
  SIN_ZA_EF,
  TIPOS_ACTIVIDAD_CRONOGRAMA,
  validarFilaProgramacion,
  type CambioCronograma,
  type EstacionNueva,
  type EstadoFilaCronograma,
  type FilaExistente,
  type FilaProgramacion,
  type FilaProgramacionEntrada,
  type FilaResuelta,
  type TipoActividadCronograma,
} from '@campo/core';
import { derivarAplicabilidad, geomDesdeUtm, sincronizarReservas, type Db } from '@campo/db';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { noAutorizado, ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import { exigirGlobal, noEncontrado } from '../alcance/autorizacion.ts';
import { insertarFilasBorrador, filasDelBorrador } from '../cronograma/borrador.ts';
import { solicitarEnTransaccion } from '../cronograma/servicio.ts';
import type { AlCambiarCronograma } from '../mapas/servicio.ts';
import { generarPlantilla } from './excel.ts';

/**
 * Carga de la programación A01 desde la web (RF-W09, decisión del usuario 2026-11-08).
 *
 * 1. Plantilla descargable con las hojas y columnas de A01 (vacía o con la programación vigente).
 * 2. Carga (Excel o tabla de la web) → vista previa sin aplicar: nuevas, cambios, sin cambio,
 *    estaciones nuevas, no incluidas y errores por fila. Se guarda la importación con sus filas.
 * 3. Aplicar (Coordinación o JdP): sin cronograma base → al borrador (RF-W12); con base → una
 *    solicitud de reprogramación con todos los cambios, o «Aplicar ahora» del JdP (RN-35, RN-36).
 *    Las estaciones nuevas se crean con la misma lógica que la web (UTM → EPSG:4326 con PostGIS,
 *    matriz estación–método y reservas). Nada se borra; aplicar dos veces → 409.
 * 4. El Supervisor de campo «solo sugiere» (decisión provisional del usuario): descarga y sube
 *    para sus brigadas, y envía su carga como `propuesta` que Coordinación o JdP aplican o
 *    descartan con motivo.
 */

const comoKysely = (db: Db): Kysely<unknown> => db as unknown as Kysely<unknown>;

// ── Alcance ───────────────────────────────────────────────────────────────────

/** `null`: todas las brigadas (Coordinación o JdP); si no, las brigadas que puede sugerir. */
type Alcance = readonly string[] | null;

const exigirProyecto = async (db: Db, proyectoId: string) => {
  const p = await db
    .selectFrom('proyecto')
    .select(['id', 'nombre'])
    .where('id', '=', proyectoId)
    .executeTakeFirst();
  if (p === undefined) throw noEncontrado('El proyecto');
  return p;
};

const esGestion = (actor: Actor): boolean =>
  esRolGlobal(actor.rolGlobal) && nivelPermiso(actor.rolGlobal, 'sugerir_programacion') === 'total';

/** Brigadas del proyecto que el actor puede programar o sugerir (`sugerir_programacion`). */
const alcanceDe = async (db: Db, actor: Actor, proyectoId: string): Promise<Alcance> => {
  if (esGestion(actor)) return null;
  const filas = await db
    .selectFrom('miembro_brigada as m')
    .innerJoin('brigada as b', 'b.id', 'm.brigada_id')
    .select(['b.id', 'm.rol'])
    .where('m.usuario_id', '=', actor.usuarioId)
    .where('m.estado', '=', 'activo')
    .where('b.proyecto_id', '=', proyectoId)
    .execute();
  const ids = filas
    .filter((f) => esRolBrigada(f.rol) && nivelPermiso(f.rol, 'sugerir_programacion') === 'alcance')
    .map((f) => f.id);
  if (ids.length === 0) throw noAutorizado();
  return ids;
};

const enAlcance = (alcance: Alcance, brigadaId: string): boolean =>
  alcance === null || alcance.includes(brigadaId);

// ── Datos del proyecto ────────────────────────────────────────────────────────

interface BrigadaProyecto {
  readonly id: string;
  readonly codigo: string | null;
  readonly nombre: string;
  readonly region: string | null;
  readonly tipo: string;
}

interface EstacionProyecto {
  readonly id: string;
  readonly codigo: string;
  readonly zona_utm: string | null;
  readonly este: number | null;
  readonly norte: number | null;
  readonly aid_aii: string | null;
  readonly uv: string | null;
  readonly za_ef: string | null;
  readonly region: string | null;
}

const brigadasDe = (db: Db, proyectoId: string): Promise<BrigadaProyecto[]> =>
  db
    .selectFrom('brigada')
    .select(['id', 'codigo', 'nombre', 'region', 'tipo'])
    .where('proyecto_id', '=', proyectoId)
    .orderBy('codigo')
    .orderBy('nombre')
    .execute();

const estacionesDe = async (db: Db, proyectoId: string): Promise<EstacionProyecto[]> =>
  (
    await db
      .selectFrom('estacion')
      .select(['id', 'codigo', 'zona_utm', 'este', 'norte', 'aid_aii', 'uv', 'za_ef', 'region'])
      .where('proyecto_id', '=', proyectoId)
      .execute()
  ).map((e) => ({
    ...e,
    este: e.este === null ? null : Number(e.este),
    norte: e.norte === null ? null : Number(e.norte),
  }));

const etiquetaBrigada = (b: { codigo: string | null; nombre: string }): string =>
  b.codigo ?? b.nombre;

const tieneBase = async (db: Db, proyectoId: string): Promise<boolean> =>
  (await db
    .selectFrom('cronograma_version as v')
    .innerJoin('campania as c', 'c.id', 'v.campania_id')
    .select('v.id')
    .where('c.proyecto_id', '=', proyectoId)
    .where('v.es_base', '=', true)
    .executeTakeFirst()) !== undefined;

const vigenteDe = async (db: Db, proyectoId: string) =>
  db
    .selectFrom('cronograma_version as v')
    .innerJoin('campania as c', 'c.id', 'v.campania_id')
    .select(['v.id', 'v.numero'])
    .where('c.proyecto_id', '=', proyectoId)
    .where('v.estado', '=', 'vigente')
    .orderBy(sql`c.estado = 'activa'`, 'desc')
    .orderBy('c.creado_en', 'desc')
    .executeTakeFirst();

interface FilaActual {
  readonly id: string;
  readonly brigada_id: string;
  readonly fecha: string;
  readonly tipo_actividad: TipoActividadCronograma;
  readonly estacion_id: string | null;
  readonly detalle: string | null;
  readonly estado_fila: EstadoFilaCronograma;
  readonly actividad_especial: string | null;
}

const comoFilaActual = (f: {
  id: string;
  brigada_id: string;
  fecha: string;
  tipo_actividad: string;
  estacion_id: string | null;
  detalle: string | null;
  estado_fila: string;
  actividad_especial: string | null;
}): FilaActual => {
  const tipo = TIPOS_ACTIVIDAD_CRONOGRAMA.find((t) => t === f.tipo_actividad);
  const estado = ESTADOS_FILA_CRONOGRAMA.find((e) => e === f.estado_fila);
  if (tipo === undefined || estado === undefined) throw new Error('Valor desconocido en la BD');
  return { ...f, tipo_actividad: tipo, estado_fila: estado };
};

/** Programación contra la que se compara: la versión vigente o, sin base, el borrador. */
const programacionActual = async (
  db: Db,
  proyectoId: string,
): Promise<{ destino: 'borrador' | 'solicitud'; filas: FilaActual[] }> => {
  if (await tieneBase(db, proyectoId)) {
    const v = await vigenteDe(db, proyectoId);
    if (v === undefined) return { destino: 'solicitud', filas: [] };
    const filas = await db
      .selectFrom('cronograma_item')
      .select([
        'id',
        'brigada_id',
        sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
        'tipo_actividad',
        'estacion_id',
        'detalle',
        'estado_fila',
        'actividad_especial',
      ])
      .where('version_id', '=', v.id)
      .orderBy('fecha')
      .orderBy('orden')
      .execute();
    return { destino: 'solicitud', filas: filas.map(comoFilaActual) };
  }
  const filas = await filasDelBorrador(db, proyectoId);
  return {
    destino: 'borrador',
    filas: filas.map((f) =>
      comoFilaActual({
        id: f.id,
        brigada_id: f.brigada_id,
        fecha: f.fecha,
        tipo_actividad: f.tipo_actividad,
        estacion_id: f.estacion_id,
        detalle: f.detalle,
        estado_fila: f.estado_fila,
        actividad_especial: f.actividad_especial,
      }),
    ),
  };
};

// ── Plantilla ─────────────────────────────────────────────────────────────────

const aAscii = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'proyecto';

export const descargarPlantilla = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  conDatos: boolean,
): Promise<{ archivo: Buffer; nombre: string }> => {
  const proyecto = await exigirProyecto(db, proyectoId);
  const alcance = await alcanceDe(db, actor, proyectoId);
  const brigadas = (await brigadasDe(db, proyectoId)).filter((b) => enAlcance(alcance, b.id));
  const estaciones = await estacionesDe(db, proyectoId);
  const porEstacion = new Map(estaciones.map((e) => [e.id, e]));
  const porBrigada = new Map(brigadas.map((b) => [b.id, b]));
  const zaEf = [...new Set(estaciones.flatMap((e) => (e.za_ef === null ? [] : [e.za_ef])))].sort();

  let filas: FilaProgramacionEntrada[] = [];
  let fuente: string | null = null;
  if (conDatos) {
    const actual = await programacionActual(db, proyectoId);
    fuente =
      actual.destino === 'borrador'
        ? 'el borrador del cronograma base (aún sin publicar)'
        : 'la versión vigente del cronograma';
    const contador = { programacion: 1, actividades_especiales: 1 };
    filas = actual.filas.flatMap((f) => {
      const b = porBrigada.get(f.brigada_id);
      if (b === undefined) return [];
      const e = f.estacion_id === null ? undefined : porEstacion.get(f.estacion_id);
      const hoja = f.actividad_especial === null ? 'programacion' : 'actividades_especiales';
      contador[hoja] += 1;
      const complementaria = b.tipo === 'complementaria';
      return [
        {
          hoja,
          fila: contador[hoja],
          tipo_programacion:
            hoja === 'programacion' ? (complementaria ? 'COMPLEMENTARIA' : 'REGULAR') : null,
          region:
            hoja === 'programacion'
              ? complementaria
                ? 'COMPLEMENTARIA'
                : (b.region ?? e?.region ?? null)
              : null,
          actividad: f.actividad_especial,
          brigada: etiquetaBrigada(b),
          fecha: f.fecha,
          tipo_actividad: ETIQUETA_TIPO_ACTIVIDAD_A01[f.tipo_actividad],
          estacion: e?.codigo ?? null,
          zona_utm: e?.zona_utm ?? null,
          este: e?.este ?? null,
          norte: e?.norte ?? null,
          aid_aii: e?.aid_aii ?? null,
          uv: e?.uv ?? null,
          za_ef: e === undefined ? null : (e.za_ef ?? SIN_ZA_EF),
          detalle: f.detalle,
          estado: ETIQUETA_ESTADO_FILA_A01[f.estado_fila],
        },
      ];
    });
  }
  const archivo = await generarPlantilla({
    proyecto: proyecto.nombre,
    brigadas: brigadas.map(etiquetaBrigada),
    zaEf,
    filas,
    fuente,
  });
  const fecha = new Date().toISOString().slice(0, 10);
  return {
    archivo,
    nombre: `programacion-${aAscii(proyecto.nombre)}-${conDatos ? 'actual' : 'vacia'}-${fecha}.xlsx`,
  };
};

// ── Vista previa ──────────────────────────────────────────────────────────────

export type AccionVista = 'nueva' | 'cambio' | 'sin_cambio' | 'error' | 'no_incluida';

export interface FilaVista {
  readonly hoja: 'programacion' | 'actividades_especiales' | null;
  readonly fila: number | null;
  readonly accion: AccionVista;
  readonly estacion: string | null;
  readonly estacion_nueva: boolean;
  readonly brigada: string | null;
  readonly fecha: string | null;
  readonly actividad: string | null;
  /** Qué hará la carga con la fila, en texto claro. */
  readonly detalle: string;
  readonly errores: readonly string[];
  readonly avisos: readonly string[];
}

export interface ResumenVista {
  readonly filas: number;
  readonly nuevas: number;
  readonly cambios: number;
  readonly sin_cambio: number;
  readonly no_incluidas: number;
  readonly estaciones_nuevas: number;
  readonly errores: number;
}

interface Plan {
  readonly destino: 'borrador' | 'solicitud';
  readonly estacionesNuevas: readonly EstacionNueva[];
  readonly operaciones: readonly {
    readonly fila: FilaProgramacion;
    readonly brigada_id: string;
    readonly estacion: string | null;
    readonly comparacion: ReturnType<typeof compararProgramacion>['filas'][number];
  }[];
}

interface Vista {
  readonly destino: 'borrador' | 'solicitud';
  readonly resumen: ResumenVista;
  readonly filas: readonly FilaVista[];
  readonly plan: Plan;
}

const fechaLegible = (iso: string): string => {
  const [a, m, d] = iso.split('-');
  return `${d ?? ''}/${m ?? ''}/${a ?? ''}`;
};

const filasGuardadas = z.array(filaProgramacionEntradaSchema);

/**
 * Vista previa: valida las filas, las resuelve contra el proyecto (brigadas, estaciones) y las
 * compara con la programación actual. No escribe nada.
 */
const calcularVista = async (
  db: Db,
  proyectoId: string,
  entradas: readonly FilaProgramacionEntrada[],
  alcance: Alcance,
): Promise<Vista> => {
  const brigadas = await brigadasDe(db, proyectoId);
  const brigadaPorEtiqueta = new Map<string, BrigadaProyecto>();
  for (const b of brigadas) {
    brigadaPorEtiqueta.set(normalizarEtiqueta(b.nombre), b);
    if (b.codigo !== null) brigadaPorEtiqueta.set(normalizarEtiqueta(b.codigo), b);
  }
  const brigadaPorId = new Map(brigadas.map((b) => [b.id, b]));
  const estaciones = await estacionesDe(db, proyectoId);
  const estacionPorCodigo = new Map(estaciones.map((e) => [normalizarCodigoEstacion(e.codigo), e]));
  const estacionPorId = new Map(estaciones.map((e) => [e.id, e]));
  const actual = await programacionActual(db, proyectoId);

  interface Validada {
    readonly indice: number;
    readonly entrada: FilaProgramacionEntrada;
    readonly fila: FilaProgramacion | null;
    readonly brigada: BrigadaProyecto | null;
    readonly errores: string[];
    readonly avisos: string[];
    estacionNueva: boolean;
  }
  const nuevas = new Map<string, { datos: EstacionNueva; fila: number }>();
  const validadas: Validada[] = entradas.map((entrada, indice) => {
    const v = validarFilaProgramacion(entrada);
    const errores = [...v.errores];
    const avisos: string[] = [];
    const etiqueta = typeof entrada.brigada === 'string' ? entrada.brigada.trim() : null;
    const brigada =
      etiqueta === null || etiqueta === ''
        ? null
        : (brigadaPorEtiqueta.get(normalizarEtiqueta(etiqueta)) ?? null);
    if (etiqueta !== null && etiqueta !== '' && brigada === null) {
      errores.push(`Brigada: «${etiqueta}» no existe en el proyecto. Créela antes en Brigadas.`);
    } else if (brigada !== null && !enAlcance(alcance, brigada.id)) {
      errores.push(
        `Brigada: solo puede sugerir la programación de sus brigadas («${etiqueta ?? ''}» no es suya).`,
      );
    }
    return { indice, entrada, fila: v.valor, brigada, errores, avisos, estacionNueva: false };
  });

  // Estaciones: existentes (sus atributos registrados se conservan) o nuevas (con atributos).
  for (const v of validadas) {
    const f = v.fila;
    if (f === null || f.estacion === null) continue;
    const existente = estacionPorCodigo.get(f.estacion);
    if (existente !== undefined) {
      const distintos: string[] = [];
      if (f.zona_utm !== null && f.zona_utm !== existente.zona_utm) distintos.push('Zona UTM');
      if (f.este !== null && existente.este !== null && Math.abs(f.este - existente.este) > 0.01) {
        distintos.push('Este');
      }
      if (
        f.norte !== null &&
        existente.norte !== null &&
        Math.abs(f.norte - existente.norte) > 0.01
      ) {
        distintos.push('Norte');
      }
      if (f.aid_aii !== null && f.aid_aii !== existente.aid_aii) distintos.push('AID/AII');
      if (f.uv !== null && f.uv !== existente.uv) distintos.push('UV preliminar');
      if (f.zona_utm !== null && f.za_ef !== existente.za_ef) distintos.push('ZA/EF');
      if (distintos.length > 0) {
        v.avisos.push(
          `${distintos.join(', ')} de ${existente.codigo} difieren de los registrados: se conservan los registrados (corríjalos en Estaciones si hace falta).`,
        );
      }
      continue;
    }
    v.estacionNueva = true;
    const datos = estacionNuevaSchema.safeParse({
      codigo: f.estacion,
      zona_utm: f.zona_utm ?? '',
      este: f.este ?? Number.NaN,
      norte: f.norte ?? Number.NaN,
      aid_aii: f.aid_aii ?? '',
      uv: f.uv ?? '',
      za_ef: f.za_ef,
      region: regionDeFila(f),
    });
    if (!datos.success) {
      v.errores.push(
        `Estación nueva «${f.estacion}»: indique Zona UTM, Este, Norte, AID/AII y UV preliminar para crearla.`,
      );
      continue;
    }
    const previa = nuevas.get(f.estacion);
    if (previa === undefined) {
      nuevas.set(f.estacion, { datos: datos.data, fila: f.fila });
      continue;
    }
    const a = previa.datos;
    const b = datos.data;
    if (
      a.zona_utm !== b.zona_utm ||
      a.este !== b.este ||
      a.norte !== b.norte ||
      a.aid_aii !== b.aid_aii ||
      a.uv !== b.uv ||
      a.za_ef !== b.za_ef
    ) {
      v.errores.push(
        `Estación nueva «${f.estacion}»: sus atributos no coinciden con los de la fila ${String(previa.fila)}.`,
      );
    }
    // Región: la primera fila regular que la indique.
    if (a.region === null && b.region !== null)
      nuevas.set(f.estacion, { ...previa, datos: { ...a, region: b.region } });
  }

  // Filas repetidas en el archivo.
  const vistas = new Map<string, number>();
  for (const v of validadas) {
    if (v.fila === null || v.errores.length > 0) continue;
    const x = v.fila;
    const clave = JSON.stringify([
      x.actividad_especial,
      x.brigada,
      x.fecha,
      x.tipo_actividad,
      x.estacion,
      x.detalle,
      x.estado_fila,
    ]);
    const previa = vistas.get(clave);
    if (previa === undefined) vistas.set(clave, v.fila.fila);
    else v.avisos.push(`Es igual a la fila ${String(previa)}: se cargará dos veces.`);
  }

  const resueltas: FilaResuelta[] = [];
  for (const v of validadas) {
    if (v.fila === null || v.brigada === null || v.errores.length > 0) continue;
    resueltas.push({
      indice: v.indice,
      brigada_id: v.brigada.id,
      fecha: v.fila.fecha,
      tipo_actividad: v.fila.tipo_actividad,
      estacion: v.fila.estacion,
      actividad_especial: v.fila.actividad_especial,
      detalle: v.fila.detalle,
      estado_fila: v.fila.estado_fila,
    });
  }
  const existentes: FilaExistente[] = actual.filas
    .filter((f) => enAlcance(alcance, f.brigada_id))
    .map((f) => ({
      id: f.id,
      brigada_id: f.brigada_id,
      fecha: f.fecha,
      tipo_actividad: f.tipo_actividad,
      estacion:
        f.estacion_id === null
          ? null
          : normalizarCodigoEstacion(estacionPorId.get(f.estacion_id)?.codigo ?? f.estacion_id),
      actividad_especial: f.actividad_especial,
      detalle: f.detalle,
      estado_fila: f.estado_fila,
    }));
  const comparacion = compararProgramacion(resueltas, existentes);
  const porIndice = new Map(comparacion.filas.map((c) => [c.indice, c]));
  const etiquetaDeId = (id: string): string => {
    const b = brigadaPorId.get(id);
    return b === undefined ? '—' : etiquetaBrigada(b);
  };

  const filasVista: FilaVista[] = [];
  const operaciones: Plan['operaciones'][number][] = [];
  const contar = { nuevas: 0, cambios: 0, sin_cambio: 0 };
  for (const v of validadas) {
    const f = v.fila;
    const e = v.entrada;
    const base = {
      hoja: e.hoja,
      fila: e.fila,
      estacion:
        f?.estacion ??
        (typeof e.estacion === 'string' && e.estacion.trim() !== '' ? e.estacion.trim() : null),
      estacion_nueva: v.estacionNueva,
      brigada:
        v.brigada === null
          ? typeof e.brigada === 'string'
            ? e.brigada
            : null
          : etiquetaBrigada(v.brigada),
      fecha: f?.fecha ?? (typeof e.fecha === 'string' ? e.fecha : null),
      actividad:
        f === null ? null : (f.actividad_especial ?? ETIQUETA_TIPO_ACTIVIDAD_A01[f.tipo_actividad]),
      avisos: v.avisos,
    };
    const c = porIndice.get(v.indice);
    if (f === null || v.brigada === null || c === undefined || v.errores.length > 0) {
      filasVista.push({
        ...base,
        accion: 'error',
        detalle: 'No se cargará hasta corregir la fila.',
        errores: v.errores,
      });
      continue;
    }
    operaciones.push({ fila: f, brigada_id: v.brigada.id, estacion: f.estacion, comparacion: c });
    let detalle: string;
    if (c.accion === 'nueva') {
      contar.nuevas += 1;
      detalle = v.estacionNueva
        ? 'Actividad nueva con una estación nueva (se creará con sus atributos).'
        : 'Actividad nueva.';
    } else if (c.accion === 'cambio') {
      contar.cambios += 1;
      const partes: string[] = [];
      if (c.fecha !== undefined)
        partes.push(`Fecha ${fechaLegible(c.fecha.antes)} → ${fechaLegible(c.fecha.despues)}`);
      if (c.brigada !== undefined)
        partes.push(
          `Brigada ${etiquetaDeId(c.brigada.antes)} → ${etiquetaDeId(c.brigada.despues)}`,
        );
      if (c.estado_fila !== undefined) {
        partes.push(
          `Estado ${ETIQUETA_ESTADO_FILA_A01[c.estado_fila.antes]} → ${ETIQUETA_ESTADO_FILA_A01[c.estado_fila.despues]}`,
        );
      }
      detalle = `${partes.join('; ')}.`;
    } else {
      contar.sin_cambio += 1;
      detalle = 'Sin cambio.';
    }
    if (c.detalle_distinto) {
      v.avisos.push('El detalle operativo difiere del registrado: no se cambia por carga.');
    }
    filasVista.push({ ...base, accion: c.accion, detalle, errores: [] });
  }
  const actualPorId = new Map(actual.filas.map((f) => [f.id, f]));
  for (const id of comparacion.no_incluidas) {
    const f = actualPorId.get(id);
    if (f === undefined) continue;
    filasVista.push({
      hoja: null,
      fila: null,
      accion: 'no_incluida',
      estacion: f.estacion_id === null ? null : (estacionPorId.get(f.estacion_id)?.codigo ?? null),
      estacion_nueva: false,
      brigada: etiquetaDeId(f.brigada_id),
      fecha: f.fecha,
      actividad: f.actividad_especial ?? ETIQUETA_TIPO_ACTIVIDAD_A01[f.tipo_actividad],
      detalle: 'No viene en el archivo: se conserva sin cambios (nada se elimina).',
      errores: [],
      avisos: [],
    });
  }
  const errores = filasVista.filter((x) => x.accion === 'error').length;
  // Una estación nueva cuenta solo si alguna de sus filas se cargará.
  const usadas = new Set(operaciones.flatMap((o) => (o.estacion === null ? [] : [o.estacion])));
  const estacionesNuevas = [...nuevas.entries()]
    .filter(([c]) => usadas.has(c))
    .map(([, n]) => n.datos);
  return {
    destino: actual.destino,
    resumen: {
      filas: entradas.length,
      nuevas: contar.nuevas,
      cambios: contar.cambios,
      sin_cambio: contar.sin_cambio,
      no_incluidas: comparacion.no_incluidas.length,
      estaciones_nuevas: estacionesNuevas.length,
      errores,
    },
    filas: filasVista,
    plan: { destino: actual.destino, estacionesNuevas, operaciones },
  };
};

// ── Importación guardada ──────────────────────────────────────────────────────

export interface Carga {
  readonly origen: 'excel' | 'web';
  readonly filas: readonly FilaProgramacionEntrada[];
  readonly archivo?: { readonly nombre: string | null; readonly datos: Buffer };
}

const respuesta = (
  imp: {
    id: string;
    estado: string;
    origen: string;
    nombre_archivo: string | null;
    creado_por_nombre?: string | null;
    creado_en?: Date | string;
    motivo?: string | null;
  },
  v: Vista,
) => ({
  importacion_id: imp.id,
  estado: imp.estado,
  origen: imp.origen,
  nombre_archivo: imp.nombre_archivo,
  autor: imp.creado_por_nombre ?? null,
  creado_en: imp.creado_en ?? null,
  motivo: imp.motivo ?? null,
  destino: v.destino,
  resumen: v.resumen,
  filas: v.filas,
});

/** Antes de leer un archivo: el proyecto existe y el actor puede cargar o sugerir. */
export const autorizarCarga = async (db: Db, actor: Actor, proyectoId: string): Promise<void> => {
  await exigirProyecto(db, proyectoId);
  await alcanceDe(db, actor, proyectoId);
};

/** Carga → vista previa (sin aplicar). Guarda la importación `pendiente`. */
export const previsualizar = async (db: Db, actor: Actor, proyectoId: string, carga: Carga) => {
  await exigirProyecto(db, proyectoId);
  const alcance = await alcanceDe(db, actor, proyectoId);
  const filas = filasGuardadas.parse(carga.filas);
  const vista = await calcularVista(db, proyectoId, filas, alcance);
  const id = generarId();
  await db
    .insertInto('importacion_programacion')
    .values({
      id,
      proyecto_id: proyectoId,
      origen: carga.origen,
      nombre_archivo: carga.archivo?.nombre ?? null,
      hash_archivo:
        carga.archivo === undefined
          ? null
          : createHash('sha256').update(carga.archivo.datos).digest('hex'),
      tamano_bytes: carga.archivo?.datos.length ?? null,
      filas: JSON.stringify(filas),
      alcance_brigadas: alcance === null ? null : [...alcance],
      resumen: JSON.stringify(vista.resumen),
      creado_por: actor.usuarioId,
      actualizado_por: actor.usuarioId,
    })
    .execute();
  return respuesta(
    {
      id,
      estado: 'pendiente',
      origen: carga.origen,
      nombre_archivo: carga.archivo?.nombre ?? null,
      motivo: null,
    },
    vista,
  );
};

const cargarImportacion = async (db: Db, id: string, bloquear = false) => {
  let q = db
    .selectFrom('importacion_programacion as i')
    .innerJoin('usuario as u', 'u.id', 'i.creado_por')
    .select([
      'i.id',
      'i.proyecto_id',
      'i.origen',
      'i.nombre_archivo',
      'i.filas',
      'i.alcance_brigadas',
      'i.estado',
      'i.motivo',
      'i.creado_por',
      'i.creado_en',
      'u.nombre as creado_por_nombre',
    ])
    .where('i.id', '=', id);
  if (bloquear) q = q.forUpdate('i');
  const imp = await q.executeTakeFirst();
  if (imp === undefined) throw noEncontrado('La carga de programación');
  return { ...imp, filas: filasGuardadas.parse(imp.filas) };
};

/** Coordinación y JdP ven toda carga del proyecto; los demás, solo las suyas. */
const exigirVerImportacion = async (
  db: Db,
  actor: Actor,
  imp: { proyecto_id: string; creado_por: string },
) => {
  if (esGestion(actor)) return;
  await alcanceDe(db, actor, imp.proyecto_id);
  if (imp.creado_por !== actor.usuarioId) throw noEncontrado('La carga de programación');
};

export const verImportacion = async (db: Db, actor: Actor, id: string) => {
  const imp = await cargarImportacion(db, id);
  await exigirVerImportacion(db, actor, imp);
  const alcance = imp.alcance_brigadas;
  return respuesta(imp, await calcularVista(db, imp.proyecto_id, imp.filas, alcance));
};

export const listarImportaciones = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  estado: 'pendiente' | 'propuesta' | 'aplicada' | 'descartada' | undefined,
) => {
  await exigirProyecto(db, proyectoId);
  const gestion = esGestion(actor);
  if (!gestion) await alcanceDe(db, actor, proyectoId);
  let q = db
    .selectFrom('importacion_programacion as i')
    .innerJoin('usuario as u', 'u.id', 'i.creado_por')
    .select([
      'i.id',
      'i.estado',
      'i.origen',
      'i.nombre_archivo',
      'i.resumen',
      'i.destino',
      'i.solicitud_id',
      'i.motivo',
      'i.motivo_descarte',
      'i.creado_en',
      'i.propuesta_en',
      'i.aplicada_en',
      'u.nombre as autor',
    ])
    .where('i.proyecto_id', '=', proyectoId)
    .orderBy('i.creado_en', 'desc')
    .limit(100);
  if (estado !== undefined) q = q.where('i.estado', '=', estado);
  if (!gestion) q = q.where('i.creado_por', '=', actor.usuarioId);
  return { importaciones: await q.execute() };
};

const yaProcesada = (): ProblemaHttp =>
  new ProblemaHttp(
    409,
    'IMPORTACION_YA_PROCESADA',
    'Esta carga ya se aplicó o se descartó. Suba el archivo de nuevo si necesita otra carga.',
  );

/** El autor (con permiso de sugerir) envía su carga como propuesta para Coordinación o JdP. */
export const proponerImportacion = async (db: Db, actor: Actor, id: string, motivo: string) => {
  await db.transaction().execute(async (tx) => {
    const imp = await cargarImportacion(tx, id, true);
    await exigirVerImportacion(tx, actor, imp);
    if (imp.creado_por !== actor.usuarioId) throw noAutorizado();
    if (imp.estado !== 'pendiente') throw yaProcesada();
    const vista = await calcularVista(tx, imp.proyecto_id, imp.filas, imp.alcance_brigadas);
    if (vista.resumen.errores > 0) {
      throw new ProblemaHttp(
        409,
        'IMPORTACION_CON_ERRORES',
        'Corrija las filas con errores antes de enviarla.',
      );
    }
    await tx
      .updateTable('importacion_programacion')
      .set({
        estado: 'propuesta',
        motivo,
        propuesta_en: new Date(),
        resumen: JSON.stringify(vista.resumen),
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', id)
      .execute();
  });
};

/** Coordinación o JdP descartan una carga (o el autor la suya), con motivo. Nada se borra. */
export const descartarImportacion = async (db: Db, actor: Actor, id: string, motivo: string) => {
  await db.transaction().execute(async (tx) => {
    const imp = await cargarImportacion(tx, id, true);
    await exigirVerImportacion(tx, actor, imp);
    if (imp.estado !== 'pendiente' && imp.estado !== 'propuesta') throw yaProcesada();
    await tx
      .updateTable('importacion_programacion')
      .set({
        estado: 'descartada',
        motivo_descarte: motivo,
        descartada_en: new Date(),
        descartada_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', id)
      .execute();
  });
};

// ── Aplicar ───────────────────────────────────────────────────────────────────

export interface ResultadoAplicar {
  readonly destino: 'borrador' | 'solicitud' | 'aplicada_ahora';
  readonly estaciones_creadas: number;
  readonly filas_agregadas: number;
  readonly filas_cambiadas: number;
  readonly solicitud_id: string | null;
  readonly version_numero: number | null;
}

/**
 * Aplica una carga (solo Coordinación o JdP, `configurar_proyecto`). La vista previa se vuelve a
 * calcular dentro de la transacción: si la programación cambió entre medio, se aplica sobre la
 * actual; si aparecen errores, no se aplica nada.
 */
export const aplicarImportacion = async (
  db: Db,
  actor: Actor,
  id: string,
  opciones: { readonly motivo: string; readonly aplicarAhora: boolean },
  alCambiar?: AlCambiarCronograma,
): Promise<ResultadoAplicar> => {
  const previa = await cargarImportacion(db, id);
  await exigirVerImportacion(db, actor, previa);
  exigirGlobal(actor, 'configurar_proyecto');
  if (opciones.aplicarAhora) exigirGlobal(actor, 'aprobar_cronograma');
  const proyectoId = previa.proyecto_id;
  const r = await db.transaction().execute(async (tx) => {
    // Serializa con la publicación del borrador y con otra carga del mismo proyecto.
    await tx.selectFrom('proyecto').select('id').where('id', '=', proyectoId).forUpdate().execute();
    const imp = await cargarImportacion(tx, id, true);
    if (imp.estado !== 'pendiente' && imp.estado !== 'propuesta') throw yaProcesada();
    const vista = await calcularVista(tx, proyectoId, imp.filas, imp.alcance_brigadas);
    if (vista.resumen.errores > 0) {
      throw new ProblemaHttp(
        409,
        'IMPORTACION_CON_ERRORES',
        'La carga tiene filas con errores: corríjalas y vuelva a subir el archivo.',
      );
    }
    const { plan } = vista;
    const aplicables = plan.operaciones.filter((o) => o.comparacion.accion !== 'sin_cambio');
    if (aplicables.length === 0) {
      throw new ProblemaHttp(409, 'SIN_CAMBIOS', 'La carga no trae actividades nuevas ni cambios.');
    }

    // 1. Estaciones nuevas (misma lógica que el alta desde la web: RN-28, RN-29).
    const idEstacion = new Map<string, string>();
    for (const e of await estacionesDe(tx, proyectoId)) {
      idEstacion.set(normalizarCodigoEstacion(e.codigo), e.id);
    }
    const creadas: string[] = [];
    for (const d of plan.estacionesNuevas) {
      const nuevaId = generarId();
      await tx
        .insertInto('estacion')
        .values({
          id: nuevaId,
          proyecto_id: proyectoId,
          codigo: d.codigo,
          geom: geomDesdeUtm(d.zona_utm, d.este, d.norte),
          zona_utm: d.zona_utm,
          este: d.este,
          norte: d.norte,
          aid_aii: d.aid_aii,
          uv: d.uv,
          za_ef: d.za_ef,
          region: d.region,
          creado_por: actor.usuarioId,
          actualizado_por: actor.usuarioId,
        })
        .execute();
      idEstacion.set(normalizarCodigoEstacion(d.codigo), nuevaId);
      creadas.push(nuevaId);
    }
    if (creadas.length > 0) {
      const k = comoKysely(tx);
      await derivarAplicabilidad(k, {
        proyectoId,
        estacionIds: creadas,
        usuarioId: actor.usuarioId,
      });
      await sincronizarReservas(k, {
        proyectoId,
        estacionIds: creadas,
        usuarioId: actor.usuarioId,
      });
    }
    const estacionIdDe = (codigo: string | null): string | null => {
      if (codigo === null) return null;
      const e = idEstacion.get(codigo);
      if (e === undefined) throw new Error('Estación sin id tras crearla');
      return e;
    };

    let resultado: Omit<ResultadoAplicar, 'estaciones_creadas'>;
    if (plan.destino === 'borrador') {
      // 2a. Sin base: al borrador (las versiones son inmutables; el borrador no).
      const nuevas = aplicables.filter((o) => o.comparacion.accion === 'nueva');
      await insertarFilasBorrador(
        tx,
        actor,
        proyectoId,
        nuevas.map((o) => ({
          brigada_id: o.brigada_id,
          fecha: o.fila.fecha,
          tipo_actividad: o.fila.tipo_actividad,
          estacion_id: estacionIdDe(o.estacion),
          detalle: o.fila.detalle,
          estado_fila: o.fila.estado_fila,
          actividad_especial: o.fila.actividad_especial,
        })),
      );
      const cambiadas = aplicables.filter((o) => o.comparacion.accion === 'cambio');
      for (const o of cambiadas) {
        if (o.comparacion.item_id === null) continue;
        await tx
          .updateTable('cronograma_borrador_item')
          .set({
            fecha: o.fila.fecha,
            brigada_id: o.brigada_id,
            estado_fila: o.fila.estado_fila,
            actualizado_por: actor.usuarioId,
          })
          .where('id', '=', o.comparacion.item_id)
          .where('estado', '=', 'borrador')
          .execute();
      }
      resultado = {
        destino: 'borrador',
        filas_agregadas: nuevas.length,
        filas_cambiadas: cambiadas.length,
        solicitud_id: null,
        version_numero: null,
      };
    } else {
      // 2b. Con base: una solicitud de reprogramación con todos los cambios (RN-35, RN-36).
      const cambios: CambioCronograma[] = aplicables.flatMap((o) =>
        cambiosDeFilaComparada(
          o.comparacion,
          {
            brigada_id: o.brigada_id,
            fecha: o.fila.fecha,
            tipo_actividad: o.fila.tipo_actividad,
            estacion_id: estacionIdDe(o.estacion),
            detalle: o.fila.detalle,
            actividad_especial: o.fila.actividad_especial,
            estado_fila: o.fila.estado_fila,
          },
          generarId,
        ),
      );
      const s = await solicitarEnTransaccion(
        tx,
        actor,
        proyectoId,
        { motivo: opciones.motivo, cambios, alertaId: null },
        opciones.aplicarAhora,
      );
      resultado = {
        destino: opciones.aplicarAhora ? 'aplicada_ahora' : 'solicitud',
        filas_agregadas: aplicables.filter((o) => o.comparacion.accion === 'nueva').length,
        filas_cambiadas: aplicables.filter((o) => o.comparacion.accion === 'cambio').length,
        solicitud_id: s.solicitud_id,
        version_numero: s.numero,
      };
    }
    await tx
      .updateTable('importacion_programacion')
      .set({
        estado: 'aplicada',
        destino: resultado.destino,
        solicitud_id: resultado.solicitud_id,
        motivo: opciones.motivo,
        resumen: JSON.stringify(vista.resumen),
        aplicada_en: new Date(),
        aplicada_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', id)
      .execute();
    return { ...resultado, estaciones_creadas: creadas.length };
  });
  // Después del commit: si cambió la versión vigente, las áreas de mapa de las brigadas.
  if (r.destino === 'aplicada_ahora') await alCambiar?.(proyectoId, actor.usuarioId);
  return r;
};
