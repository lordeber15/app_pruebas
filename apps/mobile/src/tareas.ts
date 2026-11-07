import { ejecutar, consultar } from './bd.ts';
import { avisarCambio } from './estado.ts';
import { registrarEvento } from './eventos.ts';
import { generarId } from './plataforma.ts';
import { pedir } from './sesion.ts';

/** Tareas del paquete de campo y acciones locales. Todo funciona sin conexión salvo descargar. */

export interface TareaLocal {
  id: string;
  asignacion_id: string | null;
  proyecto_id: string;
  cuaderno_titulo: string | null;
  titulo: string;
  descripcion: string | null;
  tipo: string;
  estado: string;
  estado_local: string;
  estacion_id: string | null;
  metodologia_id: string | null;
  lat: number | null;
  lon: number | null;
  validacion_activa: number;
  revocada: number;
  motivo_revocacion: string | null;
}

export interface Disponible {
  id: string;
  titulo: string;
  tipo: string;
  cuaderno: { id: string; titulo: string };
  proyecto: { id: string; nombre: string };
}

export const listarDisponibles = () =>
  pedir<{ tareas: Disponible[] }>('GET', '/api/v1/paquete/disponible');

interface Paquete {
  asignaciones: { tarea_id: string; asignacion_id: string }[];
  rechazadas: { tarea_id: string; motivo: string }[];
  paquete: {
    tareas: {
      id: string;
      proyecto_id: string;
      cuaderno_titulo: string;
      titulo: string;
      descripcion: string | null;
      tipo: string;
      estado: string;
      estacion_id: string | null;
      metodologia_id: string | null;
      geom: { type: string; coordinates: [number, number] } | null;
      validacion_activa: boolean;
      asignacion_id: string | null;
    }[];
    estaciones: { id: string; codigo: string; geom: { coordinates: [number, number] } | null }[];
    metodologias: {
      id: string;
      estacion_id: string;
      metodologia_id: string;
      meta_esfuerzo: string | null;
      nombre: string;
      unidad: string;
      requiere_transecto: boolean;
    }[];
  };
}

/** Descarga (RN-03): el servidor retiene las tareas en este celular y devuelve el paquete. */
export const descargar = async (
  ids: string[],
): Promise<{ descargadas: number; rechazadas: number }> => {
  const r = await pedir<Paquete>('POST', '/api/v1/paquete/descargas', { tarea_ids: ids });
  const ahora = new Date().toISOString();
  for (const t of r.paquete.tareas) {
    const [lon, lat] = t.geom?.type === 'Point' ? t.geom.coordinates : [null, null];
    await ejecutar(
      `INSERT INTO paquete_tarea (id, asignacion_id, proyecto_id, cuaderno_titulo, titulo, descripcion, tipo, estado, estado_local,
         estacion_id, metodologia_id, lat, lon, validacion_activa, revocada, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'descargada', ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET asignacion_id = excluded.asignacion_id, estado = excluded.estado,
         estado_local = 'descargada', revocada = 0, actualizado_en = excluded.actualizado_en`,
      [
        t.id,
        t.asignacion_id,
        t.proyecto_id,
        t.cuaderno_titulo,
        t.titulo,
        t.descripcion,
        t.tipo,
        t.estado,
        t.estacion_id,
        t.metodologia_id,
        lat,
        lon,
        t.validacion_activa ? 1 : 0,
        ahora,
      ],
    );
  }
  for (const s of r.paquete.estaciones) {
    await ejecutar(
      'INSERT OR REPLACE INTO paquete_estacion (id, codigo, lat, lon) VALUES (?, ?, ?, ?)',
      [s.id, s.codigo, s.geom?.coordinates[1] ?? null, s.geom?.coordinates[0] ?? null],
    );
  }
  for (const m of r.paquete.metodologias) {
    await ejecutar(
      'INSERT OR REPLACE INTO paquete_metodologia (id, estacion_id, metodologia_id, nombre, unidad, meta_esfuerzo, requiere_transecto) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        m.id,
        m.estacion_id,
        m.metodologia_id,
        m.nombre,
        m.unidad,
        m.meta_esfuerzo === null ? null : Number(m.meta_esfuerzo),
        m.requiere_transecto ? 1 : 0,
      ],
    );
  }
  avisarCambio();
  return { descargadas: r.asignaciones.length, rechazadas: r.rechazadas.length };
};

export const misTareas = () =>
  consultar<TareaLocal & { fotos: number; evidencias: number }>(
    `SELECT t.*, (SELECT count(*) FROM archivo_local a WHERE a.tarea_id = t.id) AS fotos,
            (SELECT count(*) FROM evidencia_local e WHERE e.tarea_id = t.id) AS evidencias
       FROM paquete_tarea t ORDER BY t.revocada, t.estado_local = 'completada', t.titulo`,
  );

export const tarea = async (id: string) =>
  (await consultar<TareaLocal>('SELECT * FROM paquete_tarea WHERE id = ?', [id]))[0] ?? null;

export const metodologiaDe = async (t: TareaLocal) =>
  t.estacion_id === null || t.metodologia_id === null
    ? null
    : ((
        await consultar<{
          id: string;
          nombre: string;
          unidad: string;
          meta_esfuerzo: number | null;
        }>(
          'SELECT id, nombre, unidad, meta_esfuerzo FROM paquete_metodologia WHERE estacion_id = ? AND metodologia_id = ?',
          [t.estacion_id, t.metodologia_id],
        )
      )[0] ?? null);

export const fotosDe = (tareaId: string) =>
  consultar<{
    id: string;
    uri: string;
    estado: string;
    evidencia_item_id: string | null;
    capturado_en: string;
  }>(
    'SELECT id, uri, estado, evidencia_item_id, capturado_en FROM archivo_local WHERE tarea_id = ? ORDER BY capturado_en',
    [tareaId],
  );

export const evidenciasDe = (tareaId: string) =>
  consultar<{ id: string; descripcion: string; orden: number }>(
    'SELECT id, descripcion, orden FROM evidencia_local WHERE tarea_id = ? ORDER BY orden',
    [tareaId],
  );

export const esfuerzoDe = (tareaId: string) =>
  consultar<{ id: string; fase: string; cantidad: number; fecha: string }>(
    'SELECT id, fase, cantidad, fecha FROM esfuerzo_local WHERE tarea_id = ? ORDER BY fecha',
    [tareaId],
  );

export const comentariosDe = (tareaId: string) =>
  consultar<{ id: string; texto: string; propio: number; creado_en: string }>(
    'SELECT id, texto, propio, creado_en FROM comentario_local WHERE tarea_id = ? ORDER BY creado_en',
    [tareaId],
  );

export const crearEvidencia = async (t: TareaLocal, descripcion: string): Promise<string> => {
  const id = generarId();
  const [ultimo] = await consultar<{ n: number }>(
    'SELECT count(*) AS n FROM evidencia_local WHERE tarea_id = ?',
    [t.id],
  );
  const orden = ultimo?.n ?? 0;
  await ejecutar(
    'INSERT INTO evidencia_local (id, tarea_id, descripcion, orden, creado_en) VALUES (?, ?, ?, ?, ?)',
    [id, t.id, descripcion, orden, new Date().toISOString()],
  );
  await registrarEvento({
    tipo: 'evidencia_item_creado',
    asignacion_id: t.asignacion_id,
    entidad: { tipo: 'evidencia_item', id },
    payload: { tarea_id: t.id, descripcion, geom: null, orden },
  });
  return id;
};

/** RN-19: cada registro de esfuerzo es una fila nueva; el total lo suma el servidor. */
export const registrarEsfuerzo = async (
  t: TareaLocal,
  estacionMetodologiaId: string,
  fase: string,
  cantidad: number,
) => {
  const fecha = new Date().toISOString().slice(0, 10);
  const id = await registrarEvento({
    tipo: 'esfuerzo_registrado',
    asignacion_id: t.asignacion_id,
    entidad: { tipo: 'estacion_metodologia', id: estacionMetodologiaId },
    payload: { estacion_metodologia_id: estacionMetodologiaId, fase, cantidad, fecha },
  });
  await ejecutar(
    'INSERT INTO esfuerzo_local (id, tarea_id, estacion_metodologia_id, fase, cantidad, fecha) VALUES (?, ?, ?, ?, ?, ?)',
    [id, t.id, estacionMetodologiaId, fase, cantidad, fecha],
  );
  avisarCambio();
};

export const comentar = async (t: TareaLocal, texto: string) => {
  const id = generarId();
  await registrarEvento({
    tipo: 'comentario_creado',
    asignacion_id: t.asignacion_id,
    entidad: { tipo: 'comentario', id },
    payload: { tarea_id: t.id, texto },
  });
  await ejecutar(
    'INSERT INTO comentario_local (id, tarea_id, texto, propio, creado_en) VALUES (?, ?, ?, 1, ?)',
    [id, t.id, texto, new Date().toISOString()],
  );
  avisarCambio();
};

/** RN-04: completar exige al menos una foto tomada con la cámara de la app. */
export const completar = async (t: TareaLocal): Promise<void> => {
  const fotos = await fotosDe(t.id);
  if (fotos.length === 0) throw new Error('Tome al menos una foto antes de completar la tarea.');
  await registrarEvento({
    tipo: 'tarea_completada',
    asignacion_id: t.asignacion_id,
    entidad: { tipo: 'tarea', id: t.id },
    payload: { tarea_id: t.id, archivo_ids: fotos.map((f) => f.id) },
  });
  await ejecutar("UPDATE paquete_tarea SET estado_local = 'completada' WHERE id = ?", [t.id]);
  avisarCambio();
};

// ── Jornada (RN-23) ──

export const jornadaAbierta = async () =>
  (
    await consultar<{ id: string; abierta_en: string }>(
      'SELECT id, abierta_en FROM jornada_local WHERE cerrada_en IS NULL LIMIT 1',
    )
  )[0] ?? null;

export const abrirJornada = async () => {
  const id = generarId();
  await registrarEvento({
    tipo: 'jornada_iniciada',
    asignacion_id: null,
    entidad: { tipo: 'jornada', id },
    payload: {},
  });
  await ejecutar('INSERT INTO jornada_local (id, abierta_en) VALUES (?, ?)', [
    id,
    new Date().toISOString(),
  ]);
  avisarCambio();
};

export const cerrarJornada = async (id: string) => {
  await registrarEvento({
    tipo: 'jornada_cerrada',
    asignacion_id: null,
    entidad: { tipo: 'jornada', id },
    payload: { automatica: false },
  });
  await ejecutar('UPDATE jornada_local SET cerrada_en = ? WHERE id = ?', [
    new Date().toISOString(),
    id,
  ]);
  avisarCambio();
};
