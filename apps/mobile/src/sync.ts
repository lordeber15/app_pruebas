import { File } from 'expo-file-system';
import { Upload } from 'tus-js-client';
import { borrarTodo, consultar, ejecutar, guardarEstadoSync, leerEstadoSync } from './bd.ts';
import { actualizarPendientes, avisarCambio, useApp } from './estado.ts';
import { descargarPaqueteCampo, leerPaquete } from './campo.ts';
import { ErrorServidor, olvidarSesion, pedir, servidor, tokenActual } from './sesion.ts';

/**
 * Sincronización (doc. 02 §6.4, RN-18). Orden:
 * 1. Eventos de la outbox (incluye el manifiesto de archivos), en lotes de hasta 500.
 * 2. Fotos de 2 048 px: primero las de tareas completadas, luego el resto.
 * 3. Estado de los archivos: lo verificado por el servidor se borra del celular (RN-17).
 * 4. Bajada incremental: tareas nuevas, revocaciones, estados, comentarios y orden de baja.
 */
const LOTE = 500;
const TROZO = 5 * 1024 * 1024;
const SIN_AVANCE_MS = 30_000;
const SIETE_DIAS = 7 * 24 * 60 * 60 * 1000;
const TREINTA_MIN = 30 * 60 * 1000;

interface FilaOutbox {
  id: string;
  cuerpo: string;
}

const enviarEventos = async (): Promise<void> => {
  for (;;) {
    const filas = await consultar<FilaOutbox>(
      "SELECT id, cuerpo FROM outbox WHERE estado = 'pendiente' ORDER BY creado_en, id LIMIT ?",
      [LOTE],
    );
    if (filas.length === 0) return;
    const r = await pedir<{ resultados: { id: string; estado: string; motivo?: string }[] }>(
      'POST',
      '/api/v1/sync/eventos',
      {
        eventos: filas.map((f) => JSON.parse(f.cuerpo) as unknown),
      },
    );
    const ahora = new Date().toISOString();
    for (const res of r.resultados) {
      // Cualquier estado final saca el evento de la cola; se conserva 7 días como registro.
      await ejecutar(
        "UPDATE outbox SET estado = 'enviado', resultado = ?, motivo = ?, resuelto_en = ? WHERE id = ?",
        [res.estado, res.motivo ?? null, ahora, res.id],
      );
    }
    await ejecutar('DELETE FROM outbox WHERE resuelto_en IS NOT NULL AND resuelto_en < ?', [
      new Date(Date.now() - SIETE_DIAS).toISOString(),
    ]);
    avisarCambio();
  }
};

interface FilaArchivo {
  id: string;
  uri: string;
  sha256: string;
  url_subida: string | null;
}

const subirArchivo = async (base: string, token: string, a: FilaArchivo): Promise<void> =>
  new Promise((resolver, rechazar) => {
    let vigilante: ReturnType<typeof setTimeout> | undefined;
    const rearmar = () => {
      clearTimeout(vigilante);
      // Android no corta solo una conexión muerta (aprendido en PoC-05).
      vigilante = setTimeout(() => {
        void subida.abort(false).catch(() => undefined);
        rechazar(new Error('Subida sin avance'));
      }, SIN_AVANCE_MS);
    };
    const subida = new Upload(
      { uri: a.uri },
      {
        endpoint: `${base}/files/`,
        uploadUrl: a.url_subida,
        chunkSize: TROZO,
        retryDelays: null,
        headers: { authorization: `Bearer ${token}` },
        metadata: { archivo_id: a.id, variante: 'preview', sha256: a.sha256 },
        onUploadUrlAvailable: () => {
          void ejecutar('UPDATE archivo_local SET url_subida = ? WHERE id = ?', [
            subida.url ?? null,
            a.id,
          ]);
        },
        onProgress: rearmar,
        onSuccess: () => {
          clearTimeout(vigilante);
          resolver();
        },
        onError: (e) => {
          clearTimeout(vigilante);
          rechazar(e);
        },
      },
    );
    rearmar();
    subida.start();
  });

const subirArchivos = async (): Promise<void> => {
  const base = await servidor();
  // RN-18: primero las fotos de ejecuciones cerradas (y de tareas completadas), luego el resto.
  const pendientes = await consultar<FilaArchivo>(
    `SELECT a.id, a.uri, a.sha256, a.url_subida FROM archivo_local a
       LEFT JOIN paquete_tarea t ON t.id = a.tarea_id
       LEFT JOIN ejecucion_local x ON x.id = a.ejecucion_id
      WHERE a.estado = 'pendiente'
      ORDER BY CASE WHEN t.estado_local = 'completada' OR x.estado_local = 'cerrada' THEN 0 ELSE 1 END,
               a.capturado_en`,
  );
  for (const a of pendientes) {
    const sesionActual = (await tokenActual()) ?? '';
    if (sesionActual === '') return;
    try {
      await subirArchivo(base, sesionActual, a);
      await ejecutar("UPDATE archivo_local SET estado = 'subido' WHERE id = ?", [a.id]);
    } catch (e) {
      const texto = String(e);
      // Ya verificado o rechazado por el servidor: se resuelve al consultar su estado.
      if (texto.includes('YA_VERIFICADO'))
        await ejecutar("UPDATE archivo_local SET estado = 'subido' WHERE id = ?", [a.id]);
      // Una URL vieja que el servidor ya no reconoce: se vuelve a crear la subida.
      else if (texto.includes('404'))
        await ejecutar('UPDATE archivo_local SET url_subida = NULL WHERE id = ?', [a.id]);
      else throw e;
    }
    avisarCambio();
  }
};

/** RN-17: el archivo se borra del celular solo cuando el servidor confirmó su hash. */
const liberarVerificados = async (): Promise<void> => {
  const locales = await consultar<{ id: string; uri: string }>(
    "SELECT id, uri FROM archivo_local WHERE estado IN ('pendiente', 'subido')",
  );
  for (let i = 0; i < locales.length; i += 500) {
    const grupo = locales.slice(i, i + 500);
    const r = await pedir<{ archivos: { id: string; estado: string }[] }>(
      'POST',
      '/api/v1/archivos/estado',
      { ids: grupo.map((g) => g.id) },
    );
    for (const a of r.archivos) {
      const local = grupo.find((g) => g.id === a.id);
      if (local === undefined) continue;
      if (a.estado === 'preview_verificada' || a.estado === 'original_verificado') {
        const f = new File(local.uri);
        if (f.exists) f.delete();
        await ejecutar("UPDATE archivo_local SET estado = 'verificado' WHERE id = ?", [a.id]);
      } else if (a.estado === 'error') {
        // Hash distinto en el servidor: se vuelve a subir.
        await ejecutar(
          "UPDATE archivo_local SET estado = 'pendiente', url_subida = NULL WHERE id = ?",
          [a.id],
        );
      }
    }
  }
};

interface Cambio {
  entidad: 'tarea' | 'comentario' | 'dispositivo' | 'archivo';
  id: string;
  operacion: 'disponible' | 'revocada' | 'estado' | 'creado' | 'baja' | 'observada';
  datos: Record<string, unknown>;
}

/** Devuelve true si llegó la orden de baja (el llamador cierra la sesión). */
const bajarCambios = async (): Promise<boolean> => {
  const cursor = (await leerEstadoSync('cursor')) ?? '';
  const r = await pedir<{ cambios: Cambio[]; cursor: string }>(
    'GET',
    `/api/v1/sync/cambios${cursor === '' ? '' : `?desde=${encodeURIComponent(cursor)}`}`,
  );
  let disponibles = 0;
  for (const c of r.cambios) {
    if (c.entidad === 'dispositivo' && c.operacion === 'baja') return true;
    if (c.entidad === 'tarea' && c.operacion === 'disponible') disponibles++;
    if (c.entidad === 'tarea' && c.operacion === 'revocada') {
      await ejecutar(
        'UPDATE paquete_tarea SET revocada = 1, motivo_revocacion = ? WHERE id = ? AND asignacion_id = ?',
        [
          typeof c.datos['motivo'] === 'string' ? c.datos['motivo'] : null,
          c.id,
          typeof c.datos['asignacion_id'] === 'string' ? c.datos['asignacion_id'] : '',
        ],
      );
    }
    // Observada: vuelve a este celular con una asignación nueva para corregir (doc. 02 §7.2).
    if (
      c.entidad === 'tarea' &&
      c.operacion === 'observada' &&
      typeof c.datos['asignacion_id'] === 'string'
    ) {
      await ejecutar(
        "UPDATE paquete_tarea SET asignacion_id = ?, estado = 'descargada', estado_local = 'descargada' WHERE id = ?",
        [c.datos['asignacion_id'], c.id],
      );
    }
    if (
      c.entidad === 'tarea' &&
      c.operacion === 'estado' &&
      typeof c.datos['estado'] === 'string'
    ) {
      await ejecutar('UPDATE paquete_tarea SET estado = ? WHERE id = ?', [c.datos['estado'], c.id]);
    }
    if (c.entidad === 'comentario' && c.operacion === 'creado') {
      await ejecutar(
        'INSERT OR IGNORE INTO comentario_local (id, tarea_id, texto, propio, creado_en) VALUES (?, ?, ?, 0, ?)',
        [c.id, String(c.datos['tarea_id']), String(c.datos['texto']), String(c.datos['creado_en'])],
      );
    }
  }
  await guardarEstadoSync('cursor', r.cursor);
  await guardarEstadoSync('disponibles', String(disponibles));
  return false;
};

let enCurso: Promise<void> | null = null;

/** Sincroniza todo lo pendiente. Si ya hay una sincronización en curso, espera esa. */
export const sincronizar = (opciones: { paquete?: boolean } = {}): Promise<void> => {
  if (enCurso !== null) return enCurso;
  enCurso = (async () => {
    useApp.setState({ sincronizando: true, ultimoError: null });
    try {
      await enviarEventos();
      await subirArchivos();
      await liberarVerificados();
      if (await bajarCambios()) {
        await borrarTodo();
        await olvidarSesion();
        useApp.setState({
          ultimoError: 'Este celular fue dado de baja. Sus datos locales se borraron.',
        });
        return;
      }
      // Cronograma vigente y configuración al día (CA-15), a lo más cada 30 min para no gastar
      // datos móviles; «Actualizar» en el inicio lo fuerza. Un usuario sin brigada no tiene paquete.
      const local = await leerPaquete();
      if (
        opciones.paquete ||
        local === null ||
        Date.now() - Date.parse(local.descargado_en) > TREINTA_MIN
      ) {
        try {
          await descargarPaqueteCampo();
        } catch (e) {
          if (!(e instanceof ErrorServidor) || e.estado !== 403) throw e;
        }
      }
      useApp.setState({ ultimaSync: new Date().toISOString() });
    } catch (e) {
      useApp.setState({
        ultimoError:
          e instanceof ErrorServidor
            ? e.message
            : 'La sincronización se interrumpió. Se reintentará.',
      });
    } finally {
      useApp.setState({ sincronizando: false });
      await actualizarPendientes();
      avisarCambio();
      enCurso = null;
    }
  })();
  return enCurso;
};
