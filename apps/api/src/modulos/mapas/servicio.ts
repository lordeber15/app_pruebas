import {
  bboxDePuntos,
  esRolGlobal,
  nivelPermiso,
  puedeIntentar,
  validarAreaUsuario,
  type Bbox,
  type CrearPaqueteMapa,
  type DescargaPaqueteMapa,
  type PaqueteMapa,
} from '@campo/core';
import type { Db } from '@campo/db';
import { noAutorizado, ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import type { Firmador } from '../../plataforma/almacenamiento.ts';
import {
  brigadasVisibles,
  exigirGlobal,
  noEncontrado,
  rolEnBrigada,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';
import * as repo from './repositorio.ts';

/**
 * Paquetes de mapa sin conexión (RF-M05, CA-08, V-10).
 *
 * - Ver, pedir un área y descargar: `descargar_paquete` con alcance de brigada. Coordinación y JdP
 *   ven todo el proyecto; el personal de campo, solo los paquetes de sus brigadas activas.
 * - Generar las áreas de las brigadas: `configurar_proyecto` (Coordinación y JdP). También se
 *   actualizan solas al publicar el cronograma base y al aprobar un cambio (después del commit).
 * - Regenerar: `configurar_proyecto` o quien lo pidió.
 * - El recorte lo hace el worker (`generar_paquete_mapa`): aquí solo se deja `pendiente` y se
 *   avisa con NOTIFY `paquete_mapa`.
 */

/** Paquetes de usuario que no terminaron en error, por usuario y proyecto. */
export const MAXIMO_PAQUETES_USUARIO = 10;

export interface OpcionesMapas {
  readonly zoomMax: number;
  readonly ladoMaximoKm: number;
}

/** Brigadas del proyecto donde el actor puede ver y descargar paquetes; null = todas. */
const brigadasConPaquetes = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
): Promise<string[] | null> => {
  if (veTodosLosProyectos(actor)) return null;
  const mapa = await brigadasVisibles(db, actor, proyectoId);
  return [...mapa].filter(([, rol]) => puedeIntentar(rol, 'descargar_paquete')).map(([id]) => id);
};

/** Paquete al alcance del actor (como el listado); 404 si no. */
const paqueteEnAlcance = async (db: Db, actor: Actor, id: string) => {
  const p = await repo.buscarPaquete(db, id);
  if (p === null) throw noEncontrado('El paquete de mapa');
  if (veTodosLosProyectos(actor)) return p;
  const rol = p.brigada_id === null ? null : await rolEnBrigada(db, actor, p.brigada_id);
  if (rol === null || !puedeIntentar(rol, 'descargar_paquete')) {
    throw noEncontrado('El paquete de mapa');
  }
  return p;
};

export const listarPaquetes = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
): Promise<PaqueteMapa[]> => {
  if (!(await repo.existeProyecto(db, proyectoId))) throw noEncontrado('El proyecto');
  const brigadas = await brigadasConPaquetes(db, actor, proyectoId);
  if (brigadas?.length === 0) throw noEncontrado('El proyecto');
  return (await repo.listarPaquetes(db, proyectoId, brigadas)).map(repo.publico);
};

export const crearPaquete = async (
  db: Db,
  actor: Actor,
  opciones: OpcionesMapas,
  proyectoId: string,
  pedido: CrearPaqueteMapa,
): Promise<PaqueteMapa> => {
  if (!(await repo.existeProyecto(db, proyectoId))) throw noEncontrado('El proyecto');
  const brigadas = await brigadasConPaquetes(db, actor, proyectoId);
  if (brigadas?.length === 0) throw noEncontrado('El proyecto');

  let brigadaId: string | null = pedido.brigada_id ?? null;
  if (brigadas === null) {
    if (brigadaId !== null && !(await repo.brigadaDelProyecto(db, proyectoId, brigadaId))) {
      throw noEncontrado('La brigada');
    }
  } else if (brigadaId === null) {
    // Personal de campo: el área es de su brigada; si tiene una sola en el proyecto, esa.
    if (brigadas.length !== 1) {
      throw new ProblemaHttp(
        400,
        'BRIGADA_OBLIGATORIA',
        'Indique la brigada a la que pertenece el área.',
      );
    }
    brigadaId = brigadas[0] ?? null;
  } else if (!brigadas.includes(brigadaId)) {
    throw noEncontrado('La brigada');
  }

  const area = validarAreaUsuario(pedido.bbox, opciones.ladoMaximoKm);
  if (!area.ok) throw new ProblemaHttp(422, area.motivo, area.mensaje);

  const id = generarId();
  await db.transaction().execute(async (tx) => {
    await repo.bloquearAltas(tx, proyectoId, actor.usuarioId);
    if (
      (await repo.contarPaquetesDeUsuario(tx, proyectoId, actor.usuarioId)) >=
      MAXIMO_PAQUETES_USUARIO
    ) {
      throw new ProblemaHttp(
        409,
        'LIMITE_PAQUETES',
        `Ya tiene ${String(MAXIMO_PAQUETES_USUARIO)} áreas de mapa en este proyecto. Use una de ellas o pida que se retire alguna.`,
      );
    }
    await repo.insertarPaquete(tx, {
      id,
      proyectoId,
      brigadaId,
      origen: 'usuario',
      nombre: pedido.nombre,
      bbox: pedido.bbox,
      zoomMax: opciones.zoomMax,
      usuarioId: actor.usuarioId,
    });
    await repo.avisarWorker(tx, id);
  });
  const p = await repo.buscarPaquete(db, id);
  if (p === null) throw new Error('El paquete recién creado no se encontró');
  return repo.publico(p);
};

const mismoBbox = (a: Bbox, b: Bbox): boolean =>
  a.every((x, i) => Math.abs(x - (b[i] ?? NaN)) < 1e-9);

/**
 * Crea o actualiza el paquete `brigada` de cada brigada con estaciones en el cronograma vigente.
 * Área = estaciones + 5 km (`bboxDePuntos`). Si cambió el área o se fuerza: versión
 * nueva y `pendiente`. Sin autorización: la hace quien la llama.
 */
export const actualizarPaquetesBrigada = async (
  db: Db,
  proyectoId: string,
  usuarioId: string | null,
  opciones: { readonly zoomMax: number; readonly forzar?: boolean },
): Promise<PaqueteMapa[]> => {
  await db.transaction().execute(async (tx) => {
    const filas = await repo.estacionesPorBrigada(tx, proyectoId);
    const porBrigada = new Map<
      string,
      { nombre: string; codigo: string | null; puntos: { lat: number; lon: number }[] }
    >();
    for (const f of filas) {
      const b = porBrigada.get(f.brigada_id) ?? {
        nombre: f.brigada_nombre,
        codigo: f.brigada_codigo,
        puntos: [],
      };
      b.puntos.push({ lat: f.lat, lon: f.lon });
      porBrigada.set(f.brigada_id, b);
    }
    for (const [brigadaId, b] of porBrigada) {
      const bbox = bboxDePuntos(b.puntos);
      if (bbox === null) continue;
      const nombre = `Área de la brigada ${b.codigo ?? b.nombre}`.slice(0, 80);
      const nuevoId = generarId();
      const insertado = await repo.insertarPaquete(tx, {
        id: nuevoId,
        proyectoId,
        brigadaId,
        origen: 'brigada',
        nombre,
        bbox,
        zoomMax: opciones.zoomMax,
        usuarioId,
      });
      if (insertado) {
        await repo.avisarWorker(tx, nuevoId);
        continue;
      }
      const actual = await repo.paqueteDeBrigadaParaActualizar(tx, proyectoId, brigadaId);
      if (actual === undefined) continue;
      const previo: Bbox = [actual.oeste, actual.sur, actual.este, actual.norte];
      // El zoom no se compara: el worker guarda el real (la fuente puede llegar a menos).
      const cambio = !mismoBbox(previo, bbox);
      if (cambio || opciones.forzar === true) {
        await repo.ponerPendiente(tx, actual.id, usuarioId, { bbox, zoomMax: opciones.zoomMax });
        await repo.avisarWorker(tx, actual.id);
      }
    }
  });
  return (await repo.listarPaquetes(db, proyectoId, null, 'brigada')).map(repo.publico);
};

export const generarPaquetesBrigada = async (
  db: Db,
  actor: Actor,
  opciones: OpcionesMapas,
  proyectoId: string,
  forzar: boolean,
): Promise<PaqueteMapa[]> => {
  exigirGlobal(actor, 'configurar_proyecto');
  if (!(await repo.existeProyecto(db, proyectoId))) throw noEncontrado('El proyecto');
  return actualizarPaquetesBrigada(db, proyectoId, actor.usuarioId, {
    zoomMax: opciones.zoomMax,
    forzar,
  });
};

/** Gancho que se llama tras confirmar un cambio del cronograma vigente; nunca lanza. */
export type AlCambiarCronograma = (proyectoId: string, usuarioId: string) => Promise<void>;

export const crearAlCambiarCronograma =
  (
    db: Db,
    opciones: OpcionesMapas,
    log: { warn: (o: object, m: string) => void },
  ): AlCambiarCronograma =>
  async (proyectoId, usuarioId) => {
    try {
      await actualizarPaquetesBrigada(db, proyectoId, usuarioId, { zoomMax: opciones.zoomMax });
    } catch (err) {
      // El cronograma ya quedó guardado: el área se puede generar después a mano.
      log.warn({ err, proyecto_id: proyectoId }, 'no se pudieron actualizar los mapas de brigada');
    }
  };

export const regenerarPaquete = async (db: Db, actor: Actor, id: string): Promise<PaqueteMapa> => {
  const p = await paqueteEnAlcance(db, actor, id);
  const configura =
    esRolGlobal(actor.rolGlobal) &&
    nivelPermiso(actor.rolGlobal, 'configurar_proyecto') === 'total';
  const loPidio = p.origen === 'usuario' && p.solicitado_por === actor.usuarioId;
  if (!configura && !loPidio) throw noAutorizado();
  await db.transaction().execute(async (tx) => {
    await repo.ponerPendiente(tx, id, actor.usuarioId);
    await repo.avisarWorker(tx, id);
  });
  const nuevo = await repo.buscarPaquete(db, id);
  if (nuevo === null) throw noEncontrado('El paquete de mapa');
  return repo.publico(nuevo);
};

export const descargarPaquete = async (
  db: Db,
  actor: Actor,
  firmador: Firmador,
  ttlSegundos: number,
  id: string,
): Promise<DescargaPaqueteMapa> => {
  const p = await paqueteEnAlcance(db, actor, id);
  if (p.estado !== 'listo' || p.ruta_objeto === null || p.tamano === null || p.sha256 === null) {
    throw new ProblemaHttp(
      409,
      'PAQUETE_NO_LISTO',
      'El mapa de esta área aún no está listo para descargar.',
    );
  }
  const expira = new Date(Date.now() + ttlSegundos * 1000);
  return {
    url: await firmador.firmar(p.ruta_objeto, {
      nombre: `mapa-${p.id}-v${String(p.version)}.pmtiles`,
    }),
    expira_en: expira.toISOString(),
    tamano: p.tamano,
    sha256: p.sha256,
    version: p.version,
  };
};

/** El celular confirma que guardó la versión. Dispositivo y usuario: solo de la sesión. */
export const confirmarDescarga = async (
  db: Db,
  actor: Actor,
  id: string,
  version: number,
): Promise<void> => {
  if (actor.dispositivoId === null) {
    throw new ProblemaHttp(
      400,
      'SIN_DISPOSITIVO',
      'Solo un celular activado puede confirmar la descarga de un mapa.',
    );
  }
  const p = await paqueteEnAlcance(db, actor, id);
  if (version > p.version) {
    throw new ProblemaHttp(400, 'VERSION_INVALIDA', 'Esa versión del mapa no existe.');
  }
  await repo.registrarDescarga(db, {
    id: generarId(),
    paqueteId: id,
    dispositivoId: actor.dispositivoId,
    usuarioId: actor.usuarioId,
    version,
  });
};
