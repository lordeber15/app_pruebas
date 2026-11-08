import {
  aplicarCambiosCronograma,
  cambioCronogramaSchema,
  esEstadoSolicitudCronograma,
  ESTADOS_FILA_CRONOGRAMA,
  impactoCronograma,
  puedeIntentar,
  TIPOS_ACTIVIDAD_CRONOGRAMA,
  transicionarSolicitudCronograma,
  type AccionSolicitudCronograma,
  type CambioCronograma,
  type ImpactoCronograma,
  type ItemCronograma,
  type MotivoRechazoCambio,
} from '@campo/core';
import { reubicarReservas, type Db } from '@campo/db';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  brigadasVisibles,
  exigirGlobal,
  noEncontrado,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';

/**
 * Cronograma base y vigente (D02 §10, RF-W12, RN-35, RN-36, E-08).
 *
 * - El base (versión 1, de A01) nunca se modifica; cada aprobación crea una versión vigente nueva
 *   con una copia completa de las filas (ids propios, mismo `linaje_id`) y la anterior pasa a
 *   histórica. La base de datos impide actualizar filas y versiones (migración 2026-11-08T03).
 * - Coordinación (o el JdP) propone; **solo el Jefe de Proyecto** aprueba, rechaza o pide ajuste.
 * - Una estación no ejecutada nunca desaparece: core no tiene un cambio «eliminar» y la
 *   aprobación verifica `items_desaparecidos` vacío antes de guardar.
 * - Las reservas siguen a su fila (linaje) en la versión nueva: el celular recibe la brigada y la
 *   fecha nuevas al volver a descargar el paquete de campo.
 */

const ITEMS_MAXIMOS_POR_VERSION = 5_000;

type Tx = Db;

interface FilaItem extends ItemCronograma {
  readonly linaje_id: string;
  readonly orden: number;
}

const comoItem = (f: {
  id: string;
  linaje_id: string;
  brigada_id: string;
  fecha: string;
  tipo_actividad: string;
  estacion_id: string | null;
  detalle: string | null;
  estado_fila: string;
  actividad_especial: string | null;
  orden: number;
}): FilaItem => {
  const tipo = TIPOS_ACTIVIDAD_CRONOGRAMA.find((t) => t === f.tipo_actividad);
  const estado = ESTADOS_FILA_CRONOGRAMA.find((e) => e === f.estado_fila);
  if (tipo === undefined || estado === undefined) throw new Error('Valor desconocido en la BD');
  return { ...f, tipo_actividad: tipo, estado_fila: estado };
};

const itemsDeVersion = async (db: Tx, versionId: string): Promise<FilaItem[]> =>
  (
    await db
      .selectFrom('cronograma_item')
      .select([
        'id',
        'linaje_id',
        'brigada_id',
        sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
        'tipo_actividad',
        'estacion_id',
        'detalle',
        'estado_fila',
        'actividad_especial',
        'orden',
      ])
      .where('version_id', '=', versionId)
      .orderBy('fecha')
      .orderBy('orden')
      .limit(ITEMS_MAXIMOS_POR_VERSION)
      .execute()
  ).map(comoItem);

const existeProyecto = async (db: Db, proyectoId: string): Promise<boolean> =>
  (await db.selectFrom('proyecto').select('id').where('id', '=', proyectoId).executeTakeFirst()) !==
  undefined;

/** Campaña del proyecto: la activa o, si no hay, la más reciente. */
const campaniaDe = (db: Db, proyectoId: string) =>
  db
    .selectFrom('campania')
    .select(['id', 'nombre', 'estado'])
    .where('proyecto_id', '=', proyectoId)
    .orderBy(sql`estado = 'activa'`, 'desc')
    .orderBy('creado_en', 'desc')
    .executeTakeFirst();

/**
 * Brigadas cuyo cronograma puede ver el actor (consultar_seguimiento): Coordinación y JdP todas;
 * los miembros la suya. Sin ninguna, el proyecto no está a su alcance (404).
 */
const brigadasDelCronograma = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
): Promise<string[]> => {
  if (!(await existeProyecto(db, proyectoId))) throw noEncontrado('El proyecto');
  const mapa = await brigadasVisibles(db, actor, proyectoId);
  const ids = [...mapa]
    .filter(([, rol]) => puedeIntentar(rol, 'consultar_seguimiento'))
    .map(([id]) => id);
  if (ids.length === 0 && !veTodosLosProyectos(actor)) throw noEncontrado('El proyecto');
  return ids;
};

// ── Consulta ──────────────────────────────────────────────────────────────────

export const verCronograma = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  numero: number | undefined,
) => {
  const brigadas = await brigadasDelCronograma(db, actor, proyectoId);
  const campania = await campaniaDe(db, proyectoId);
  if (campania === undefined) {
    return { campania: null, versiones: [], version: null, items: [] };
  }
  const versiones = await db
    .selectFrom('cronograma_version as v')
    .leftJoin('usuario as u', 'u.id', 'v.aprobado_por')
    .select([
      'v.id',
      'v.numero',
      'v.estado',
      'v.es_base',
      'v.solicitud_id',
      'v.aprobado_en',
      'u.nombre as aprobado_por_nombre',
    ])
    .where('v.campania_id', '=', campania.id)
    .orderBy('v.numero')
    .execute();
  const elegida =
    numero === undefined
      ? versiones.find((v) => v.estado === 'vigente')
      : versiones.find((v) => v.numero === numero);
  if (elegida === undefined) {
    if (numero !== undefined) throw noEncontrado('La versión del cronograma');
    return { campania, versiones, version: null, items: [] };
  }
  const base = versiones.find((v) => v.es_base);

  const items =
    brigadas.length === 0
      ? []
      : await db
          .selectFrom('cronograma_item as i')
          .innerJoin('brigada as b', 'b.id', 'i.brigada_id')
          .leftJoin('estacion as e', 'e.id', 'i.estacion_id')
          // La misma fila en el base, para comparar base y vigente (RN-35).
          .leftJoin('cronograma_item as ib', (j) =>
            j
              .onRef('ib.linaje_id', '=', 'i.linaje_id')
              .on('ib.version_id', '=', base?.id ?? elegida.id),
          )
          .select([
            'i.id',
            'i.linaje_id',
            'i.brigada_id',
            'b.codigo as brigada_codigo',
            'b.nombre as brigada_nombre',
            sql<string>`to_char(i.fecha, 'YYYY-MM-DD')`.as('fecha'),
            'i.tipo_actividad',
            'i.estacion_id',
            'e.codigo as estacion_codigo',
            'i.detalle',
            'i.estado_fila',
            'i.actividad_especial',
            'i.orden',
            sql<string | null>`to_char(ib.fecha, 'YYYY-MM-DD')`.as('base_fecha'),
            'ib.brigada_id as base_brigada_id',
            sql<boolean>`ib.id IS NULL`.as('agregada'),
          ])
          .where('i.version_id', '=', elegida.id)
          .where('i.brigada_id', 'in', brigadas)
          .orderBy('i.fecha')
          .orderBy('i.orden')
          .limit(ITEMS_MAXIMOS_POR_VERSION)
          .execute();

  return { campania, versiones, version: elegida, items };
};

// ── Propuesta ─────────────────────────────────────────────────────────────────

const MENSAJE_CAMBIO: Readonly<Record<MotivoRechazoCambio, string>> = {
  ITEM_INEXISTENTE:
    'Uno de los cambios se refiere a una fila que no está en el cronograma vigente.',
  ESTACION_SIN_ID: 'Una actividad agregada de tipo estación debe indicar su estación (y solo esa).',
  ID_REPETIDO: 'Una actividad agregada repite el identificador de otra fila.',
};

/** Valida los cambios contra los ítems y el proyecto; devuelve los ítems resultantes. */
const validarCambios = async (
  db: Db,
  proyectoId: string,
  items: readonly FilaItem[],
  cambios: readonly CambioCronograma[],
): Promise<readonly ItemCronograma[]> => {
  const brigadas = new Set<string>();
  const estaciones = new Set<string>();
  for (const c of cambios) {
    if (c.tipo === 'reprogramar' && c.brigada_id !== null) brigadas.add(c.brigada_id);
    if (c.tipo === 'agregar') {
      brigadas.add(c.item.brigada_id);
      if (c.item.estacion_id !== null) estaciones.add(c.item.estacion_id);
    }
  }
  if (brigadas.size > 0) {
    const n = await db
      .selectFrom('brigada')
      .select('id')
      .where('proyecto_id', '=', proyectoId)
      .where('id', 'in', [...brigadas])
      .execute();
    if (n.length !== brigadas.size) {
      throw new ProblemaHttp(400, 'CAMBIO_INVALIDO', 'Una brigada indicada no es del proyecto.');
    }
  }
  if (estaciones.size > 0) {
    const n = await db
      .selectFrom('estacion')
      .select('id')
      .where('proyecto_id', '=', proyectoId)
      .where('id', 'in', [...estaciones])
      .execute();
    if (n.length !== estaciones.size) {
      throw new ProblemaHttp(400, 'CAMBIO_INVALIDO', 'Una estación indicada no es del proyecto.');
    }
  }
  const r = aplicarCambiosCronograma(items, cambios);
  if (!r.ok) throw new ProblemaHttp(400, 'CAMBIO_INVALIDO', MENSAJE_CAMBIO[r.motivo]);
  return r.valor;
};

const vigenteDe = (db: Db, campaniaId: string) =>
  db
    .selectFrom('cronograma_version')
    .select(['id', 'numero'])
    .where('campania_id', '=', campaniaId)
    .where('estado', '=', 'vigente')
    .executeTakeFirst();

const sinCronograma = (): ProblemaHttp =>
  new ProblemaHttp(409, 'SIN_CRONOGRAMA', 'El proyecto aún no tiene un cronograma vigente.');

export interface Propuesta {
  readonly motivo: string;
  readonly cambios: readonly CambioCronograma[];
  readonly alertaId: string | null;
}

export const proponerCambio = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  p: Propuesta,
): Promise<string> => {
  exigirGlobal(actor, 'proponer_reprogramacion');
  if (!(await existeProyecto(db, proyectoId))) throw noEncontrado('El proyecto');
  const campania = await campaniaDe(db, proyectoId);
  const vigente = campania === undefined ? undefined : await vigenteDe(db, campania.id);
  if (campania === undefined || vigente === undefined) throw sinCronograma();
  await validarCambios(db, proyectoId, await itemsDeVersion(db, vigente.id), p.cambios);
  if (p.alertaId !== null) {
    const alerta = await db
      .selectFrom('alerta')
      .select('id')
      .where('id', '=', p.alertaId)
      .where('proyecto_id', '=', proyectoId)
      .executeTakeFirst();
    if (alerta === undefined) {
      throw new ProblemaHttp(400, 'ALERTA_INVALIDA', 'La alerta indicada no es del proyecto.');
    }
  }
  const id = generarId();
  await db
    .insertInto('solicitud_cronograma')
    .values({
      id,
      campania_id: campania.id,
      version_base_id: vigente.id,
      propuesto_por: actor.usuarioId,
      motivo: p.motivo,
      cambios: JSON.stringify(p.cambios),
      alerta_id: p.alertaId,
      creado_por: actor.usuarioId,
      actualizado_por: actor.usuarioId,
    })
    .execute();
  return id;
};

// ── Lista con impacto ─────────────────────────────────────────────────────────

const cambiosGuardados = z.array(cambioCronogramaSchema);

export const listarSolicitudes = async (db: Db, actor: Actor, proyectoId: string) => {
  // Las propuestas son decisiones de gestión: Coordinación y JdP (ERS §2.3).
  exigirGlobal(actor, 'proponer_reprogramacion');
  if (!(await existeProyecto(db, proyectoId))) throw noEncontrado('El proyecto');
  const solicitudes = await db
    .selectFrom('solicitud_cronograma as s')
    .innerJoin('campania as c', 'c.id', 's.campania_id')
    .innerJoin('cronograma_version as vb', 'vb.id', 's.version_base_id')
    .innerJoin('usuario as up', 'up.id', 's.propuesto_por')
    .leftJoin('usuario as ud', 'ud.id', 's.decidido_por')
    .leftJoin('cronograma_version as vn', 'vn.solicitud_id', 's.id')
    .select([
      's.id',
      's.estado',
      's.motivo',
      's.cambios',
      's.alerta_id',
      's.version_base_id',
      'vb.numero as version_base_numero',
      'vn.numero as version_resultante_numero',
      's.comentario_decision',
      's.creado_en',
      's.decidido_en',
      'up.nombre as propuesto_por_nombre',
      'ud.nombre as decidido_por_nombre',
    ])
    .where('c.proyecto_id', '=', proyectoId)
    .orderBy('s.creado_en', 'desc')
    .limit(200)
    .execute();

  const porVersion = new Map<string, FilaItem[]>();
  const items = async (versionId: string) => {
    const ya = porVersion.get(versionId);
    if (ya !== undefined) return ya;
    const nuevos = await itemsDeVersion(db, versionId);
    porVersion.set(versionId, nuevos);
    return nuevos;
  };
  const codigos = new Map(
    (
      await db
        .selectFrom('estacion')
        .select(['id', 'codigo'])
        .where('proyecto_id', '=', proyectoId)
        .execute()
    ).map((e) => [e.id, e.codigo]),
  );
  const brigadas = new Map(
    (
      await db
        .selectFrom('brigada')
        .select(['id', 'codigo', 'nombre'])
        .where('proyecto_id', '=', proyectoId)
        .execute()
    ).map((b) => [b.id, b.codigo ?? b.nombre]),
  );

  const resultado = [];
  for (const s of solicitudes) {
    const cambios = cambiosGuardados.parse(s.cambios);
    const antes = await items(s.version_base_id);
    const despues = aplicarCambiosCronograma(antes, cambios);
    const impacto: ImpactoCronograma | null = despues.ok
      ? impactoCronograma(antes, despues.valor)
      : null;
    const porId = new Map(antes.map((i) => [i.id, i]));
    resultado.push({
      id: s.id,
      estado: s.estado,
      motivo: s.motivo,
      alerta_id: s.alerta_id,
      version_base_numero: s.version_base_numero,
      version_resultante_numero: s.version_resultante_numero,
      comentario_decision: s.comentario_decision,
      creado_en: s.creado_en,
      decidido_en: s.decidido_en,
      propuesto_por_nombre: s.propuesto_por_nombre,
      decidido_por_nombre: s.decidido_por_nombre,
      cambios: cambios.map((c) => {
        if (c.tipo === 'agregar') {
          return {
            tipo: c.tipo,
            estacion_codigo:
              c.item.estacion_id === null ? null : (codigos.get(c.item.estacion_id) ?? null),
            brigada_antes: null,
            brigada_despues: brigadas.get(c.item.brigada_id) ?? null,
            fecha_antes: null,
            fecha_despues: c.item.fecha,
            estado_fila: 'ok',
            detalle: c.item.detalle,
          };
        }
        const it = porId.get(c.item_id);
        return {
          tipo: c.tipo,
          estacion_codigo: it?.estacion_id == null ? null : (codigos.get(it.estacion_id) ?? null),
          brigada_antes: it === undefined ? null : (brigadas.get(it.brigada_id) ?? null),
          brigada_despues:
            c.tipo === 'reprogramar' && c.brigada_id !== null
              ? (brigadas.get(c.brigada_id) ?? null)
              : it === undefined
                ? null
                : (brigadas.get(it.brigada_id) ?? null),
          fecha_antes: it?.fecha ?? null,
          fecha_despues: c.tipo === 'reprogramar' ? c.fecha : (it?.fecha ?? null),
          estado_fila: c.tipo === 'marcar' ? c.estado_fila : 'reprogramada',
          detalle: it?.detalle ?? null,
        };
      }),
      impacto:
        impacto === null
          ? null
          : {
              ...impacto,
              estaciones_afectadas_codigos: impacto.estaciones_afectadas.map(
                (id) => codigos.get(id) ?? id,
              ),
            },
    });
  }
  return resultado;
};

// ── Decisión del Jefe de Proyecto y ajuste de Coordinación ───────────────────

const transicionInvalida = (): ProblemaHttp =>
  new ProblemaHttp(
    409,
    'TRANSICION_INVALIDA',
    'La solicitud ya no está en un estado que lo permita.',
  );

const cargarSolicitud = async (db: Db, solicitudId: string) => {
  const s = await db
    .selectFrom('solicitud_cronograma as s')
    .innerJoin('campania as c', 'c.id', 's.campania_id')
    .select(['s.id', 's.estado', 's.campania_id', 'c.proyecto_id'])
    .where('s.id', '=', solicitudId)
    .executeTakeFirst();
  if (s === undefined) throw noEncontrado('La solicitud');
  return s;
};

/** Bloquea la solicitud y valida la transición con la máquina de core. */
const bloquearYTransicionar = async (
  tx: Tx,
  solicitudId: string,
  accion: AccionSolicitudCronograma,
) => {
  const s = await tx
    .selectFrom('solicitud_cronograma')
    .select(['id', 'estado', 'campania_id', 'version_base_id', 'cambios'])
    .where('id', '=', solicitudId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (!esEstadoSolicitudCronograma(s.estado)) throw new Error('Valor desconocido en la BD');
  const t = transicionarSolicitudCronograma(s.estado, accion);
  if (!t.ok) {
    if (t.motivo === 'COMENTARIO_OBLIGATORIO') {
      throw new ProblemaHttp(400, 'COMENTARIO_OBLIGATORIO', 'Escriba un comentario.');
    }
    throw transicionInvalida();
  }
  return { ...s, nuevo: t.valor };
};

/**
 * Aprobación (solo JdP): versión vigente nueva = vigente actual + cambios. Si entre la propuesta
 * y la aprobación se aprobó otra versión, los cambios se trasladan por linaje a la vigente.
 */
export const aprobarSolicitud = async (db: Db, actor: Actor, solicitudId: string) => {
  const sol = await cargarSolicitud(db, solicitudId);
  exigirGlobal(actor, 'aprobar_cronograma');
  return db.transaction().execute(async (tx) => {
    const s = await bloquearYTransicionar(tx, solicitudId, { tipo: 'aprobar' });
    const vigente = await tx
      .selectFrom('cronograma_version')
      .select(['id', 'numero'])
      .where('campania_id', '=', s.campania_id)
      .where('estado', '=', 'vigente')
      .forUpdate()
      .executeTakeFirst();
    if (vigente === undefined) throw sinCronograma();
    const items = await itemsDeVersion(tx, vigente.id);
    let cambios = cambiosGuardados.parse(s.cambios);
    if (s.version_base_id !== vigente.id) {
      const linajeDe = new Map(
        (await itemsDeVersion(tx, s.version_base_id)).map((i) => [i.id, i.linaje_id]),
      );
      const enVigente = new Map(items.map((i) => [i.linaje_id, i.id]));
      cambios = cambios.map((c) => {
        if (c.tipo === 'agregar') return c;
        const linaje = linajeDe.get(c.item_id);
        const actual = linaje === undefined ? undefined : enVigente.get(linaje);
        if (actual === undefined) {
          throw new ProblemaHttp(
            409,
            'CAMBIO_DESACTUALIZADO',
            'Una fila de la propuesta ya no está en el cronograma vigente. Pida un ajuste.',
          );
        }
        return { ...c, item_id: actual };
      });
    }
    const despues = await validarCambios(tx, sol.proyecto_id, items, cambios);
    // RN-35: ninguna fila desaparece. Por construcción no ocurre; si ocurriera, nada se guarda.
    if (impactoCronograma(items, despues).items_desaparecidos.length > 0) {
      throw new Error('RN-35: la versión nueva perdería filas del cronograma');
    }

    const anterior = new Map(items.map((i) => [i.id, i]));
    let orden = Math.max(0, ...items.map((i) => i.orden));
    const nuevaId = generarId();
    const numero = vigente.numero + 1;
    await tx
      .updateTable('cronograma_version')
      .set({ estado: 'historica', actualizado_por: actor.usuarioId })
      .where('id', '=', vigente.id)
      .execute();
    await tx
      .insertInto('cronograma_version')
      .values({
        id: nuevaId,
        campania_id: s.campania_id,
        numero,
        estado: 'vigente',
        es_base: false,
        solicitud_id: s.id,
        aprobado_por: actor.usuarioId,
        aprobado_en: new Date(),
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
    const filas = despues.map((i) => {
      const previo = anterior.get(i.id);
      const id = generarId();
      return {
        id,
        version_id: nuevaId,
        linaje_id: previo?.linaje_id ?? id,
        brigada_id: i.brigada_id,
        fecha: i.fecha,
        tipo_actividad: i.tipo_actividad,
        estacion_id: i.estacion_id,
        detalle: i.detalle,
        estado_fila: i.estado_fila,
        actividad_especial: i.actividad_especial,
        orden: previo?.orden ?? ++orden,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      };
    });
    for (let i = 0; i < filas.length; i += 500) {
      await tx
        .insertInto('cronograma_item')
        .values(filas.slice(i, i + 500))
        .execute();
    }
    const reservas = await reubicarReservas(tx as unknown as Kysely<unknown>, {
      proyectoId: sol.proyecto_id,
      versionAnteriorId: vigente.id,
      versionNuevaId: nuevaId,
      usuarioId: actor.usuarioId,
    });
    await tx
      .updateTable('solicitud_cronograma')
      .set({
        estado: s.nuevo,
        version_base_id: vigente.id,
        cambios: JSON.stringify(cambios),
        decidido_por: actor.usuarioId,
        decidido_en: new Date(),
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', s.id)
      .execute();
    return { version_id: nuevaId, numero, reservas_reubicadas: reservas };
  });
};

/** Rechazo o pedido de ajuste (solo JdP), con comentario obligatorio. */
export const decidirSolicitud = async (
  db: Db,
  actor: Actor,
  solicitudId: string,
  accion: { tipo: 'rechazar' | 'pedir_ajuste'; comentario: string },
): Promise<void> => {
  await cargarSolicitud(db, solicitudId);
  exigirGlobal(actor, 'aprobar_cronograma');
  await db.transaction().execute(async (tx) => {
    const s = await bloquearYTransicionar(tx, solicitudId, accion);
    await tx
      .updateTable('solicitud_cronograma')
      .set({
        estado: s.nuevo,
        comentario_decision: accion.comentario,
        decidido_por: actor.usuarioId,
        decidido_en: new Date(),
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', s.id)
      .execute();
  });
};

/** Coordinación (o JdP) reenvía la propuesta ajustada sobre el cronograma vigente actual. */
export const ajustarSolicitud = async (
  db: Db,
  actor: Actor,
  solicitudId: string,
  p: { motivo: string | null; cambios: readonly CambioCronograma[] },
): Promise<void> => {
  const sol = await cargarSolicitud(db, solicitudId);
  exigirGlobal(actor, 'proponer_reprogramacion');
  await db.transaction().execute(async (tx) => {
    const s = await bloquearYTransicionar(tx, solicitudId, { tipo: 'ajustar' });
    const vigente = await vigenteDe(tx, s.campania_id);
    if (vigente === undefined) throw sinCronograma();
    await validarCambios(tx, sol.proyecto_id, await itemsDeVersion(tx, vigente.id), p.cambios);
    await tx
      .updateTable('solicitud_cronograma')
      .set({
        estado: s.nuevo,
        cambios: JSON.stringify(p.cambios),
        version_base_id: vigente.id,
        ...(p.motivo === null ? {} : { motivo: p.motivo }),
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', s.id)
      .execute();
  });
};
