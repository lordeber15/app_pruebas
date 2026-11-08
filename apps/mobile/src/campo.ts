import {
  configuracionMetodoSchema,
  eventoSchema,
  evaluarEjecucion,
  geometriaCapturadaSchema,
  type ConfiguracionMetodo,
  type EvaluacionEjecucion,
  type GeometriaCapturada,
  type Region,
  type TipoDesviacion,
  type TipoUnidad,
  type UnidadEvaluable,
} from '@campo/core';
import { consultar, ejecutar } from './bd.ts';
import { avisarCambio } from './estado.ts';
import { registrarEvento } from './eventos.ts';
import { generarId } from './plataforma.ts';
import { pedir } from './sesion.ts';

/**
 * Trabajo de campo TOCE en el celular (D02 §6): paquete de campo, ejecución de un método en una
 * estación, sus unidades, tracks y fotos. Todo se guarda primero en local y genera eventos en la
 * outbox (RNF-01); solo descargar el paquete necesita señal. La evaluación de reglas es la de core.
 */

// ── Paquete ──────────────────────────────────────────────────────────────────────────────────

export interface EstacionPaquete {
  id: string;
  proyecto_id: string;
  codigo: string;
  zona_utm: string | null;
  este: number | null;
  norte: number | null;
  aid_aii: string | null;
  uv: string | null;
  za_ef: string | null;
  region: string | null;
  lat: number;
  lon: number;
}

export interface ItemCronogramaPaquete {
  id: string;
  brigada_id: string;
  fecha: string;
  tipo_actividad: string;
  estacion_id: string | null;
  detalle: string | null;
  estado_fila: string;
  actividad_especial: string | null;
}

export interface MetodoPaquete {
  id: string;
  especialidad_id: string;
  codigo: string;
  nombre: string;
  clase: string;
  orden: number;
  config: ConfiguracionMetodo;
}

export interface Paquete {
  generado_en: string;
  proyectos: { id: string; nombre: string; validacion_activa: boolean }[];
  brigadas: {
    id: string;
    codigo: string | null;
    nombre: string;
    region: string | null;
    tipo: string;
  }[];
  cronograma: ItemCronogramaPaquete[];
  estaciones: EstacionPaquete[];
  especialidades: {
    id: string;
    codigo: string;
    nombre: string;
    es_fauna: boolean;
    orden: number;
  }[];
  metodos: MetodoPaquete[];
  aplicabilidad: {
    estacion_id: string;
    metodo_id: string;
    habilitado: boolean;
    condicion_pendiente: boolean;
    origen: string;
  }[];
  reservas: {
    id: string;
    estacion_id: string;
    metodo_id: string;
    brigada_id: string;
    fecha_programada: string | null;
  }[];
}

let cache: { descargado_en: string; paquete: Paquete } | null = null;

/** Descarga el paquete de las brigadas del usuario (necesita señal) y lo deja listo sin conexión. */
export const descargarPaqueteCampo = async (): Promise<void> => {
  const crudo = await pedir<
    Omit<Paquete, 'metodos'> & { metodos: (Omit<MetodoPaquete, 'config'> & { config: unknown })[] }
  >('GET', '/api/v1/paquete/campo');
  const ahora = new Date().toISOString();
  await ejecutar(
    `INSERT INTO paquete_campo (clave, contenido, descargado_en) VALUES ('toce', ?, ?)
     ON CONFLICT(clave) DO UPDATE SET contenido = excluded.contenido, descargado_en = excluded.descargado_en`,
    [JSON.stringify(crudo), ahora],
  );
  cache = null;
  avisarCambio();
};

/** Paquete local; los métodos cuya configuración no valida con el esquema de core se omiten. */
export const leerPaquete = async (): Promise<{
  descargado_en: string;
  paquete: Paquete;
} | null> => {
  const [fila] = await consultar<{ contenido: string; descargado_en: string }>(
    "SELECT contenido, descargado_en FROM paquete_campo WHERE clave = 'toce'",
  );
  if (fila === undefined) return null;
  if (cache?.descargado_en === fila.descargado_en) return cache;
  const crudo = JSON.parse(fila.contenido) as Omit<Paquete, 'metodos'> & {
    metodos: (Omit<MetodoPaquete, 'config'> & { config: unknown })[];
  };
  const metodos = crudo.metodos.flatMap((m) => {
    const c = configuracionMetodoSchema.safeParse(m.config);
    return c.success ? [{ ...m, config: c.data }] : [];
  });
  cache = { descargado_en: fila.descargado_en, paquete: { ...crudo, metodos } };
  return cache;
};

export const fechaLocal = (d = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${String(y)}-${m}-${dia}`;
};

export interface EstacionDelDia {
  estacion: EstacionPaquete;
  fechas: string[];
  brigada: string;
  estado_fila: string;
  actividad_especial: string | null;
}

/**
 * Estaciones del cronograma vigente agrupadas por fecha: hoy, próximas y anteriores (las no
 * ejecutadas nunca desaparecen, RN-35). Una estación de varios días aparece en cada fecha.
 */
export const agendaDeEstaciones = (p: Paquete) => {
  const porId = new Map(p.estaciones.map((e) => [e.id, e]));
  const brigadas = new Map(p.brigadas.map((b) => [b.id, b.codigo ?? b.nombre]));
  const porFecha = new Map<string, EstacionDelDia[]>();
  for (const i of p.cronograma) {
    if (i.estacion_id === null) continue;
    const est = porId.get(i.estacion_id);
    if (est === undefined) continue;
    const lista = porFecha.get(i.fecha) ?? [];
    if (!lista.some((x) => x.estacion.id === est.id)) {
      lista.push({
        estacion: est,
        fechas: [i.fecha],
        brigada: brigadas.get(i.brigada_id) ?? '',
        estado_fila: i.estado_fila,
        actividad_especial: i.actividad_especial,
      });
    }
    porFecha.set(i.fecha, lista);
  }
  const otras = p.cronograma.filter((i) => i.estacion_id === null);
  return { porFecha, otras };
};

export interface MetodoEnEstacion {
  metodo: MetodoPaquete;
  reservaId: string | null;
  pendiente: boolean;
}

export interface EspecialidadEnEstacion {
  id: string;
  nombre: string;
  esFauna: boolean;
  metodos: MetodoEnEstacion[];
  eventos: MetodoEnEstacion[];
  porConfirmar: MetodoEnEstacion[];
}

/**
 * Lo que la app muestra al abrir una estación (E-01, RN-28): por especialidad, los métodos
 * habilitados (TODAS nunca se ocultan), los EVENTOS como registros complementarios y, aparte,
 * los CONDICIONAL pendientes de confirmación. Los ATRIBUTOS no aparecen como métodos.
 */
export const metodosDeEstacion = (p: Paquete, estacionId: string): EspecialidadEnEstacion[] => {
  const apl = new Map(
    p.aplicabilidad.filter((a) => a.estacion_id === estacionId).map((a) => [a.metodo_id, a]),
  );
  const reservas = new Map(
    p.reservas.filter((r) => r.estacion_id === estacionId).map((r) => [r.metodo_id, r.id]),
  );
  return (
    p.especialidades
      .map((esp) => {
        const propios = p.metodos.filter(
          (m) => m.especialidad_id === esp.id && m.clase !== 'atributo',
        );
        const item = (m: MetodoPaquete): MetodoEnEstacion => ({
          metodo: m,
          reservaId: reservas.get(m.id) ?? null,
          pendiente: apl.get(m.id)?.condicion_pendiente ?? false,
        });
        return {
          id: esp.id,
          nombre: esp.nombre,
          esFauna: esp.es_fauna,
          metodos: propios
            .filter((m) => m.clase !== 'evento' && apl.get(m.id)?.habilitado === true)
            .map(item),
          eventos: propios.filter((m) => m.clase === 'evento').map(item),
          porConfirmar: propios
            .filter(
              (m) =>
                m.clase === 'condicional' &&
                apl.get(m.id)?.habilitado !== true &&
                apl.get(m.id)?.condicion_pendiente === true,
            )
            .map(item),
        };
      })
      // Solo las especialidades que tienen algo que hacer en esta estación.
      .filter((e) => e.metodos.length > 0 || e.porConfirmar.length > 0)
  );
};

const REGIONES: readonly string[] = ['COSTA', 'SIERRA', 'SELVA'];
export const estacionParaReglas = (e: EstacionPaquete) => ({
  region: REGIONES.includes(e.region ?? '') ? (e.region as Region) : null,
  za_ef: e.za_ef,
  uv: e.uv,
});

// ── Ejecución ─────────────────────────────────────────────────────────────────────────────────

export interface EjecucionLocal {
  id: string;
  reserva_id: string | null;
  estacion_id: string;
  metodo_id: string;
  estado_local: 'en_curso' | 'cerrada';
  abierta_en: string;
  cerrada_en: string | null;
  datos: string;
  desviacion_tipo: TipoDesviacion;
  desviacion_explicacion: string | null;
  confirmaciones: string;
  objetivo_campo: number | null;
  incumplimientos: number | null;
  advertencias: number | null;
}

export interface UnidadLocal {
  id: string;
  ejecucion_id: string;
  codigo: string;
  tipo_unidad: TipoUnidad;
  orden: number;
  estado: 'abierta' | 'cerrada';
  geometria: string | null;
  inicio: string | null;
  fin: string | null;
  datos: string;
  registros: string;
  unidad_vinculada_id: string | null;
  parametros: string;
  evento_id: string | null;
}

export interface FotoLocal {
  id: string;
  uri: string;
  estado: string;
  unidad_id: string | null;
  tipo_foto: string | null;
  orientacion: string | null;
  candidata: number;
}

export const ejecucionesDeEstacion = (estacionId: string) =>
  consultar<EjecucionLocal & { unidades: number }>(
    `SELECT e.*, (SELECT count(*) FROM unidad_local u WHERE u.ejecucion_id = e.id) AS unidades
       FROM ejecucion_local e WHERE e.estacion_id = ? ORDER BY e.abierta_en DESC`,
    [estacionId],
  );

export const resumenPorEstacion = () =>
  consultar<{ estacion_id: string; en_curso: number; cerradas: number }>(
    `SELECT estacion_id, sum(estado_local = 'en_curso') AS en_curso, sum(estado_local = 'cerrada') AS cerradas
       FROM ejecucion_local GROUP BY estacion_id`,
  );

export const ejecucion = async (id: string) =>
  (await consultar<EjecucionLocal>('SELECT * FROM ejecucion_local WHERE id = ?', [id]))[0] ?? null;

export const unidadesDe = (ejecucionId: string) =>
  consultar<UnidadLocal>('SELECT * FROM unidad_local WHERE ejecucion_id = ? ORDER BY orden', [
    ejecucionId,
  ]);

export const unidad = async (id: string) =>
  (await consultar<UnidadLocal>('SELECT * FROM unidad_local WHERE id = ?', [id]))[0] ?? null;

export const fotosDeEjecucion = (ejecucionId: string) =>
  consultar<FotoLocal>(
    'SELECT id, uri, estado, unidad_id, tipo_foto, orientacion, candidata FROM archivo_local WHERE ejecucion_id = ? ORDER BY capturado_en',
    [ejecucionId],
  );

export const puntosDeTrack = async (unidadId: string): Promise<number> => {
  const [t] = await consultar<{ puntos: string }>(
    'SELECT puntos FROM track_local WHERE unidad_id = ?',
    [unidadId],
  );
  return t === undefined ? 0 : (JSON.parse(t.puntos) as unknown[]).length;
};

/** Abre una ejecución propia del método en la estación (RN-19: cada especialista la suya). */
export const abrirEjecucion = async (
  estacionId: string,
  metodo: MetodoEnEstacion,
): Promise<string> => {
  const id = generarId();
  const abiertaEn = new Date().toISOString();
  await registrarEvento({
    tipo: 'ejecucion_abierta',
    entidad: { tipo: 'ejecucion', id },
    payload: {
      ejecucion_id: id,
      reserva_id: metodo.reservaId,
      estacion_id: estacionId,
      metodo_id: metodo.metodo.id,
      abierta_en: abiertaEn,
    },
  });
  await ejecutar(
    'INSERT INTO ejecucion_local (id, reserva_id, estacion_id, metodo_id, abierta_en) VALUES (?, ?, ?, ?, ?)',
    [id, metodo.reservaId, estacionId, metodo.metodo.id, abiertaEn],
  );
  avisarCambio();
  return id;
};

const PREFIJO: Readonly<Record<TipoUnidad, string>> = {
  transecto: 'T',
  cuadrante: 'C',
  parcela: 'PA',
  recorrido: 'R',
  arbol: 'A',
  punto: 'P',
  trampa: 'TR',
  bandeja: 'B',
  red: 'RN',
  camara: 'CT',
  detector: 'D',
  lista: 'L',
  sector: 'S',
  abs: 'ABS',
  evento: 'E',
  atributo: 'AT',
};

/** Unidad nueva con código único dentro de la ejecución (RF-M04), p. ej. `T-03`. */
export const nuevaUnidad = async (ejecucionId: string, tipo: TipoUnidad): Promise<string> => {
  const [n] = await consultar<{ n: number; orden: number }>(
    'SELECT sum(tipo_unidad = ?) AS n, count(*) AS orden FROM unidad_local WHERE ejecucion_id = ?',
    [tipo, ejecucionId],
  );
  const id = generarId();
  const codigo = `${PREFIJO[tipo]}-${String((n?.n ?? 0) + 1).padStart(2, '0')}`;
  await ejecutar(
    'INSERT INTO unidad_local (id, ejecucion_id, codigo, tipo_unidad, orden, actualizado_en) VALUES (?, ?, ?, ?, ?, ?)',
    [id, ejecucionId, codigo, tipo, n?.orden ?? 0, new Date().toISOString()],
  );
  await enviarUnidad(id);
  return id;
};

export interface CambioUnidad {
  geometria?: GeometriaCapturada | null;
  inicio?: string | null;
  fin?: string | null;
  estado?: 'abierta' | 'cerrada';
  datos?: Record<string, unknown>;
  registros?: Record<string, unknown>[];
  unidad_vinculada_id?: string | null;
  parametros?: string[];
}

export const actualizarUnidad = async (id: string, c: CambioUnidad): Promise<void> => {
  const u = await unidad(id);
  if (u === null) return;
  await ejecutar(
    `UPDATE unidad_local SET geometria = ?, inicio = ?, fin = ?, estado = ?, datos = ?, registros = ?,
       unidad_vinculada_id = ?, parametros = ?, actualizado_en = ? WHERE id = ?`,
    [
      c.geometria === undefined
        ? u.geometria
        : c.geometria === null
          ? null
          : JSON.stringify(c.geometria),
      c.inicio === undefined ? u.inicio : c.inicio,
      c.fin === undefined ? u.fin : c.fin,
      c.estado ?? u.estado,
      c.datos === undefined ? u.datos : JSON.stringify(c.datos),
      c.registros === undefined ? u.registros : JSON.stringify(c.registros),
      c.unidad_vinculada_id === undefined ? u.unidad_vinculada_id : c.unidad_vinculada_id,
      c.parametros === undefined ? u.parametros : JSON.stringify(c.parametros),
      new Date().toISOString(),
      id,
    ],
  );
  await enviarUnidad(id);
};

/** Valores de formulario aceptados por el contrato de eventos. */
const limpiarDatos = (
  d: Record<string, unknown>,
): Record<string, string | number | boolean | null | { lat: number; lon: number }> => {
  const r: Record<string, string | number | boolean | null | { lat: number; lon: number }> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null)
      r[k] = v;
    else if (typeof v === 'object' && 'lat' in v && 'lon' in v) {
      const p = v;
      if (typeof p.lat === 'number' && typeof p.lon === 'number') r[k] = { lat: p.lat, lon: p.lon };
    }
  }
  return r;
};

/**
 * Envía el estado completo de la unidad. Si el último envío sigue en la outbox sin salir, se
 * reemplaza en su lugar (mismo id y posición): el orden con las fotos se conserva y no se
 * acumulan versiones que el servidor nunca vio.
 */
const enviarUnidad = async (id: string): Promise<void> => {
  const u = await unidad(id);
  if (u === null) return;
  const payload = {
    unidad_id: u.id,
    ejecucion_id: u.ejecucion_id,
    codigo: u.codigo,
    tipo_unidad: u.tipo_unidad,
    orden: u.orden,
    estado: u.estado,
    geometria:
      u.geometria === null ? null : geometriaCapturadaSchema.parse(JSON.parse(u.geometria)),
    inicio: u.inicio,
    fin: u.fin,
    datos: limpiarDatos(JSON.parse(u.datos) as Record<string, unknown>),
    registros: (JSON.parse(u.registros) as Record<string, unknown>[]).map(limpiarDatos),
    unidad_vinculada_id: u.unidad_vinculada_id,
    parametros_confirmados: JSON.parse(u.parametros) as string[],
  };
  if (u.evento_id !== null) {
    const [pendiente] = await consultar<{ cuerpo: string }>(
      "SELECT cuerpo FROM outbox WHERE id = ? AND estado = 'pendiente'",
      [u.evento_id],
    );
    if (pendiente !== undefined) {
      const anterior = JSON.parse(pendiente.cuerpo) as Record<string, unknown>;
      const evento = { ...anterior, hora_dispositivo: new Date().toISOString(), payload };
      const r = eventoSchema.safeParse(evento);
      if (!r.success)
        throw new Error(`Unidad inválida: ${r.error.issues[0]?.message ?? 'formato'}`);
      await ejecutar('UPDATE outbox SET cuerpo = ? WHERE id = ?', [
        JSON.stringify(evento),
        u.evento_id,
      ]);
      avisarCambio();
      return;
    }
  }
  const eventoId = await registrarEvento({
    tipo: 'unidad_guardada',
    entidad: { tipo: 'unidad', id: u.id },
    payload,
  });
  await ejecutar('UPDATE unidad_local SET evento_id = ? WHERE id = ?', [eventoId, u.id]);
};

// ── Track (RN-24): solo mientras la unidad de un método con track está abierta ───────────────

export interface PuntoTrack {
  lat: number;
  lon: number;
  altitud_m: number | null;
  precision_m: number | null;
  hora: string;
}

export const agregarPuntoTrack = async (
  ejecucionId: string,
  unidadId: string,
  p: PuntoTrack,
): Promise<number> => {
  const [t] = await consultar<{ id: string; puntos: string }>(
    'SELECT id, puntos FROM track_local WHERE unidad_id = ? AND enviado = 0',
    [unidadId],
  );
  if (t === undefined) {
    await ejecutar(
      'INSERT INTO track_local (id, ejecucion_id, unidad_id, puntos) VALUES (?, ?, ?, ?)',
      [generarId(), ejecucionId, unidadId, JSON.stringify([p])],
    );
    return 1;
  }
  const puntos = [...(JSON.parse(t.puntos) as PuntoTrack[]), p];
  await ejecutar('UPDATE track_local SET puntos = ? WHERE id = ?', [JSON.stringify(puntos), t.id]);
  return puntos.length;
};

/** Al terminar el recorrido, el track se anuncia como evento (≥ 2 puntos). */
export const cerrarTrack = async (unidadId: string): Promise<void> => {
  const [t] = await consultar<{ id: string; ejecucion_id: string; puntos: string }>(
    'SELECT id, ejecucion_id, puntos FROM track_local WHERE unidad_id = ? AND enviado = 0',
    [unidadId],
  );
  if (t === undefined) return;
  const puntos = JSON.parse(t.puntos) as PuntoTrack[];
  if (puntos.length < 2) return;
  await registrarEvento({
    tipo: 'track_registrado',
    entidad: { tipo: 'track', id: t.id },
    payload: { track_id: t.id, ejecucion_id: t.ejecucion_id, unidad_id: unidadId, puntos },
  });
  await ejecutar('UPDATE track_local SET enviado = 1 WHERE id = ?', [t.id]);
};

// ── Evaluación con el motor de core (RF-T04) ─────────────────────────────────────────────────

const json = <T>(s: string | null, defecto: T): T => (s === null ? defecto : (JSON.parse(s) as T));

export const evaluarLocal = async (
  p: Paquete,
  ejecucionId: string,
  cambios: {
    datos?: Record<string, unknown>;
    desviacion?: { tipo: TipoDesviacion; explicacion: string | null };
    confirmaciones?: string[];
    objetivo_campo?: number | null;
  } = {},
): Promise<{
  evaluacion: EvaluacionEjecucion;
  metodo: MetodoPaquete;
  estacion: EstacionPaquete;
} | null> => {
  const ej = await ejecucion(ejecucionId);
  if (ej === null) return null;
  const metodo = p.metodos.find((m) => m.id === ej.metodo_id);
  const estacion = p.estaciones.find((e) => e.id === ej.estacion_id);
  if (metodo === undefined || estacion === undefined) return null;
  const [unidades, fotos] = await Promise.all([
    unidadesDe(ejecucionId),
    fotosDeEjecucion(ejecucionId),
  ]);
  const tracks = await consultar<{ unidad_id: string; puntos: string }>(
    'SELECT unidad_id, puntos FROM track_local WHERE ejecucion_id = ?',
    [ejecucionId],
  );
  const puntosPor = new Map<string, number>();
  for (const t of tracks)
    puntosPor.set(
      t.unidad_id,
      (puntosPor.get(t.unidad_id) ?? 0) + json<unknown[]>(t.puntos, []).length,
    );
  const foto = (f: FotoLocal) => ({
    tipo: (f.tipo_foto ?? 'contexto') as
      'contexto' | 'metodologica' | 'primer_plano' | 'cientifica',
    orientacion: (f.orientacion ?? null) as 'N' | 'S' | 'E' | 'O' | null,
    heredada: false,
  });
  const evaluables: UnidadEvaluable[] = unidades.map((u) => ({
    id: u.id,
    codigo: u.codigo,
    tipo: u.tipo_unidad,
    estado: u.estado,
    geometria: json<GeometriaCapturada | null>(u.geometria, null),
    inicio: u.inicio,
    fin: u.fin,
    datos: json<Record<string, unknown>>(u.datos, {}),
    registros: json<Record<string, unknown>[]>(u.registros, []),
    fotos: fotos.filter((f) => f.unidad_id === u.id).map(foto),
    track: puntosPor.has(u.id) ? { puntos: puntosPor.get(u.id) ?? 0 } : null,
    unidad_vinculada_id: u.unidad_vinculada_id,
    parametros_confirmados: json<string[]>(u.parametros, []),
  }));
  const vinculables = await consultar<{ id: string; metodo_id: string }>(
    `SELECT u.id, e.metodo_id FROM unidad_local u JOIN ejecucion_local e ON e.id = u.ejecucion_id
      WHERE e.estacion_id = ? AND e.id != ?`,
    [ej.estacion_id, ejecucionId],
  );
  const codigoDe = new Map(p.metodos.map((m) => [m.id, m.codigo]));
  const evaluacion = evaluarEjecucion({
    metodo: metodo.config,
    estacion: estacionParaReglas(estacion),
    ejecucion: {
      abierta_en: ej.abierta_en,
      cerrada_en: ej.cerrada_en,
      datos: cambios.datos ?? json<Record<string, unknown>>(ej.datos, {}),
      desviacion: cambios.desviacion ?? {
        tipo: ej.desviacion_tipo,
        explicacion: ej.desviacion_explicacion,
      },
      confirmaciones: cambios.confirmaciones ?? json<string[]>(ej.confirmaciones, []),
      objetivo_campo:
        cambios.objetivo_campo === undefined ? ej.objetivo_campo : cambios.objetivo_campo,
      fotos: fotos.filter((f) => f.unidad_id === null).map(foto),
      unidades: evaluables,
    },
    unidades_vinculables: vinculables.map((v) => ({
      id: v.id,
      metodo: codigoDe.get(v.metodo_id) ?? '',
    })),
  });
  return { evaluacion, metodo, estacion };
};

/** Unidades de otros métodos en la misma estación, para el vínculo (RN-34). */
export const unidadesVinculables = async (p: Paquete, estacionId: string, codigoMetodo: string) => {
  const metodo = p.metodos.find((m) => m.config.codigo === codigoMetodo);
  if (metodo === undefined) return [];
  return consultar<{ id: string; codigo: string }>(
    `SELECT u.id, u.codigo FROM unidad_local u JOIN ejecucion_local e ON e.id = u.ejecucion_id
      WHERE e.estacion_id = ? AND e.metodo_id = ? AND u.tipo_unidad = ? ORDER BY u.orden`,
    [estacionId, metodo.id, metodo.config.unidad.tipo],
  );
};

export const guardarBorradorCierre = (
  ejecucionId: string,
  c: {
    datos: Record<string, unknown>;
    desviacion: { tipo: TipoDesviacion; explicacion: string | null };
    confirmaciones: string[];
    objetivo_campo: number | null;
  },
) =>
  ejecutar(
    'UPDATE ejecucion_local SET datos = ?, desviacion_tipo = ?, desviacion_explicacion = ?, confirmaciones = ?, objetivo_campo = ? WHERE id = ?',
    [
      JSON.stringify(c.datos),
      c.desviacion.tipo,
      c.desviacion.explicacion,
      JSON.stringify(c.confirmaciones),
      c.objetivo_campo,
      ejecucionId,
    ],
  );

/**
 * Cierre local (RN-05, RF-M11). Si falta algo obligatorio, solo se puede cerrar declarando una
 * desviación con explicación: la ejecución llegará como parcial y trazable (E-06).
 */
export const cerrarEjecucion = async (
  p: Paquete,
  ejecucionId: string,
  c: {
    datos: Record<string, unknown>;
    desviacion: { tipo: TipoDesviacion; explicacion: string | null };
    confirmaciones: string[];
    objetivo_campo: number | null;
  },
): Promise<void> => {
  await guardarBorradorCierre(ejecucionId, c);
  const ev = await evaluarLocal(p, ejecucionId, c);
  if (ev === null) throw new Error('No se encontró la ejecución.');
  const sinDesviacion = c.desviacion.tipo === 'ninguna';
  if (ev.evaluacion.incumplimientos_obligatorios > 0 && sinDesviacion) {
    throw new Error('Complete lo obligatorio o declare una desviación con su explicación.');
  }
  for (const u of await unidadesDe(ejecucionId)) {
    if (u.estado === 'abierta')
      await actualizarUnidad(u.id, { estado: 'cerrada', fin: u.fin ?? new Date().toISOString() });
    await cerrarTrack(u.id);
  }
  const fotos = await fotosDeEjecucion(ejecucionId);
  const cerradaEn = new Date().toISOString();
  await registrarEvento({
    tipo: 'ejecucion_cerrada',
    entidad: { tipo: 'ejecucion', id: ejecucionId },
    payload: {
      ejecucion_id: ejecucionId,
      cerrada_en: cerradaEn,
      datos: limpiarDatos(c.datos),
      desviacion: {
        tipo: c.desviacion.tipo,
        explicacion: sinDesviacion ? null : c.desviacion.explicacion,
      },
      confirmaciones: c.confirmaciones,
      objetivo_campo: c.objetivo_campo,
      archivo_ids: fotos.map((f) => f.id),
    },
  });
  const final = await evaluarLocal(p, ejecucionId, c);
  await ejecutar(
    "UPDATE ejecucion_local SET estado_local = 'cerrada', cerrada_en = ?, incumplimientos = ?, advertencias = ? WHERE id = ?",
    [
      cerradaEn,
      final?.evaluacion.incumplimientos_obligatorios ?? null,
      final?.evaluacion.advertencias ?? null,
      ejecucionId,
    ],
  );
  avisarCambio();
};
