/**
 * Cliente de la API. Mismo origen que la web (el nginx de la imagen reenvía /api), con la cookie
 * de sesión de Better Auth. Los errores llegan en RFC 9457 y se muestran tal cual a la persona.
 */
export class ErrorApi extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string, detalle: string) {
    super(detalle);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const pedir = async <T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> => {
  let r: Response;
  try {
    r = await fetch(ruta, {
      method: metodo,
      credentials: 'include',
      headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    });
  } catch {
    throw new ErrorApi(
      0,
      'SIN_CONEXION',
      'No hay conexión con el servidor. Revise su red e intente de nuevo.',
    );
  }
  if (r.status === 204) return undefined as T;
  const texto = await r.text();
  const datos: unknown = texto === '' ? null : JSON.parse(texto);
  if (!r.ok) {
    const p = (datos ?? {}) as { detail?: string; codigo?: string };
    throw new ErrorApi(
      r.status,
      p.codigo ?? 'ERROR',
      p.detail ?? 'La solicitud no se pudo completar.',
    );
  }
  return datos as T;
};

export const api = {
  get: <T>(ruta: string) => pedir<T>('GET', `/api/v1${ruta}`),
  post: <T>(ruta: string, cuerpo: unknown = {}) => pedir<T>('POST', `/api/v1${ruta}`, cuerpo),
  patch: <T>(ruta: string, cuerpo: unknown) => pedir<T>('PATCH', `/api/v1${ruta}`, cuerpo),
  entrar: (username: string, password: string) =>
    pedir<unknown>('POST', '/api/auth/sign-in/username', { username, password }),
  salir: () => pedir<unknown>('POST', '/api/auth/sign-out', {}),
};

// ── Tipos de las respuestas ──

/** Roles TOCE (ERS §2.2). Globales: Coordinación, Jefe de Proyecto, Administrador técnico. */
export type RolGlobal = 'coordinacion' | 'jefe_proyecto' | 'admin' | 'ninguno';
/** En la brigada: especialista, supervisor de campo y jefe de brigada. */
export type RolBrigada = 'especialista' | 'supervisor_campo' | 'jefe_brigada';

export const ETIQUETA_ROL_GLOBAL: Readonly<Record<RolGlobal, string>> = {
  coordinacion: 'Coordinación',
  jefe_proyecto: 'Jefe de Proyecto',
  admin: 'Administrador técnico',
  ninguno: 'Personal de campo',
};

export const ETIQUETA_ROL_BRIGADA: Readonly<Record<RolBrigada, string>> = {
  especialista: 'Especialista',
  supervisor_campo: 'Supervisor de campo',
  jefe_brigada: 'Jefe de Brigada',
};

export interface Yo {
  id: string;
  nombre: string;
  tipo_documento: string;
  num_documento: string;
  rol_global: RolGlobal;
  /** Entró con una contraseña temporal: debe cambiarla antes de seguir. */
  debe_cambiar_contrasena: boolean;
  membresias: { brigada_id: string; rol: RolBrigada }[];
}

export interface Proyecto {
  id: string;
  nombre: string;
  estado: 'activo' | 'cerrado';
  validacion_activa: boolean;
  subir_originales: boolean;
  dias_bloqueo: number;
  hora_cierre_jornada: string | null;
}

export interface Brigada {
  id: string;
  codigo: string | null;
  nombre: string;
  region: 'COSTA' | 'SIERRA' | 'SELVA' | null;
  tipo: 'regular' | 'complementaria' | 'especial';
}

export interface Miembro {
  id: string;
  usuario_id: string;
  rol: RolBrigada;
  estado: 'activo' | 'retirado';
  nombre: string;
  tipo_documento: string;
  num_documento: string;
}

export interface Usuario {
  id: string;
  tipo_documento: string;
  num_documento: string;
  nombre: string;
  rol_global: RolGlobal;
  estado: 'activo' | 'inactivo';
}

/** Estación con sus atributos de A01 (RN-29). */
export interface Estacion {
  id: string;
  codigo: string;
  region: string | null;
  uv: string | null;
  aid_aii: string | null;
  za_ef: string | null;
  zona_utm: string | null;
  este: string | null;
  norte: string | null;
  lat: number;
  lon: number;
}

export interface Revision {
  id: string;
  tipo: string;
  estado: 'en_revision' | 'duplicado';
  motivo: string | null;
  hora_servidor: string;
  ejecucion_id: string;
  estacion_codigo: string;
  metodo_nombre: string;
  usuario_nombre: string;
}

// ── Cronograma (RF-W12, RN-35, RN-36) ──

export type EstadoFilaCronograma =
  'ok' | 'pendiente_validacion' | 'reprogramada' | 'sujeta_a_decision';
export type EstadoSolicitudCronograma =
  'pendiente' | 'aprobada' | 'rechazada' | 'ajuste_solicitado';

export interface VersionCronograma {
  id: string;
  numero: number;
  estado: 'vigente' | 'historica';
  es_base: boolean;
  solicitud_id: string | null;
  aprobado_en: string | null;
  aprobado_por_nombre: string | null;
}

export interface ItemCronograma {
  id: string;
  linaje_id: string;
  brigada_id: string;
  brigada_codigo: string | null;
  brigada_nombre: string;
  fecha: string;
  tipo_actividad: string;
  estacion_id: string | null;
  estacion_codigo: string | null;
  detalle: string | null;
  estado_fila: EstadoFilaCronograma;
  actividad_especial: string | null;
  base_fecha: string | null;
  base_brigada_id: string | null;
  agregada: boolean;
}

export interface Cronograma {
  campania: { id: string; nombre: string; estado: string } | null;
  versiones: VersionCronograma[];
  version: VersionCronograma | null;
  items: ItemCronograma[];
}

export type CambioCronograma =
  | { tipo: 'reprogramar'; item_id: string; fecha: string; brigada_id: string | null }
  | { tipo: 'marcar'; item_id: string; estado_fila: EstadoFilaCronograma };

export interface SolicitudCronograma {
  id: string;
  estado: EstadoSolicitudCronograma;
  motivo: string;
  version_base_numero: number;
  version_resultante_numero: number | null;
  comentario_decision: string | null;
  creado_en: string;
  decidido_en: string | null;
  propuesto_por_nombre: string;
  decidido_por_nombre: string | null;
  cambios: {
    tipo: 'reprogramar' | 'marcar' | 'agregar';
    estacion_codigo: string | null;
    brigada_antes: string | null;
    brigada_despues: string | null;
    fecha_antes: string | null;
    fecha_despues: string | null;
    estado_fila: EstadoFilaCronograma;
    detalle: string | null;
  }[];
  impacto: {
    estaciones_afectadas_codigos: string[];
    fechas_afectadas: string[];
    items_desaparecidos: string[];
  } | null;
}

// ── Seguimiento (RF-W01, RN-37, RN-38) ──

export interface ObjetivoMetodo {
  cantidad: number | null;
  medida: 'unidades' | 'minutos';
  unidad_texto: string;
  origen: string;
  texto: string;
}

export interface FilaSeguimiento {
  estacion_id: string;
  estacion_codigo: string;
  za_ef: string | null;
  especialidad_codigo: string;
  especialidad_nombre: string;
  metodo_id: string;
  metodo_codigo: string;
  metodo_nombre: string;
  clase: string;
  fecha_programada: string | null;
  objetivo: ObjetivoMetodo;
  /** Nulo sin datos sincronizados: nunca 0 % (RN-37). */
  avance: { ejecutado: number; objetivo: number | null; porcentaje: number | null } | null;
  sin_datos: boolean;
  ejecuciones: number;
  por_estado: Record<string, number>;
  ultima_actividad: string | null;
}

export interface BrigadaSeguimiento {
  id: string;
  codigo: string | null;
  nombre: string;
  region: string | null;
  tipo: string;
  solo_propias: boolean;
  ultima_sincronizacion: string | null;
  dispositivos: { dispositivo_id: string; ultima_sincronizacion: string }[];
  filas: FilaSeguimiento[];
}

// ── Galería (E-10) ──

export interface FotoGaleria {
  id: string;
  capturado_en: string;
  tipo_foto: string | null;
  orientacion: string | null;
  candidata_reporte: boolean;
  seleccionada_reporte: boolean;
  seleccion_fecha: string | null;
  usuario_nombre: string;
  ejecucion_id: string;
  brigada_id: string | null;
  brigada_codigo: string | null;
  brigada_nombre: string | null;
  estacion_id: string;
  estacion_codigo: string;
  metodo_id: string;
  metodo_nombre: string;
  especialidad_nombre: string;
  unidad_codigo: string | null;
  puede_marcar: boolean;
}

export interface Galeria {
  fotos: FotoGaleria[];
  truncado: boolean;
  puede_seleccionar: boolean;
}
