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

// ── Ejecuciones (D02 §11) ──

export type EstadoEjecucion =
  'en_curso' | 'evidencia_pendiente' | 'completa' | 'parcial' | 'validada' | 'observada';

export interface EjecucionFila {
  id: string;
  estado: EstadoEjecucion;
  abierta_en: string;
  cerrada_en: string | null;
  qa_evaluado_en: string | null;
  desviacion_tipo: 'ninguna' | 'parcial' | 'imposibilidad' | 'excepcional';
  desviacion_explicacion: string | null;
  brigada_id: string | null;
  estacion_id: string;
  estacion_codigo: string;
  metodo_nombre: string;
  especialidad_nombre: string;
  usuario_nombre: string;
  brigada_nombre: string | null;
  unidades: number;
  incumplimientos_obligatorios: number | null;
  advertencias: number | null;
  ultima_recepcion: string | null;
}

export interface GeometriaGeoJson {
  type: string;
  coordinates: unknown;
}

export interface ResultadoReglaQa {
  regla: string;
  tipo_control: 'obligatorio' | 'advertencia' | 'informativo' | 'referencia' | 'criterio_humano';
  estado: 'cumple' | 'incumple' | 'no_aplica' | 'no_evaluable' | 'informativo';
  mensaje: string;
  texto_d01: string;
  unidad_id: string | null;
}

export interface EjecucionDetalle extends Omit<
  EjecucionFila,
  'unidades' | 'incumplimientos_obligatorios' | 'advertencias'
> {
  proyecto_id: string;
  datos: Record<string, unknown>;
  objetivo_campo: number | null;
  estacion_za_ef: string | null;
  estacion_lat: number;
  estacion_lon: number;
  metodo_codigo: string;
  resultado_qa: {
    resultados: ResultadoReglaQa[];
    incumplimientos_obligatorios: number;
    advertencias: number;
  } | null;
  unidades: {
    id: string;
    codigo: string;
    tipo_unidad: string;
    estado: 'abierta' | 'cerrada';
    orden: number;
    inicio: string | null;
    fin: string | null;
    datos: Record<string, unknown>;
    registros: Record<string, unknown>[];
    unidad_vinculada_id: string | null;
    geometria: GeometriaGeoJson | null;
  }[];
  tracks: {
    id: string;
    unidad_id: string | null;
    inicio: string;
    fin: string;
    puntos: number;
    geometria: GeometriaGeoJson | null;
  }[];
  fotos: {
    id: string;
    unidad_id: string | null;
    tipo_foto: 'contexto' | 'metodologica' | 'primer_plano' | 'cientifica' | null;
    orientacion: 'N' | 'S' | 'E' | 'O' | null;
    estado: string;
    capturado_en: string;
    candidata_reporte: boolean;
  }[];
}

// ── Alertas (D02 §9, RN-36) ──

export type TipoAlerta = 'tecnica' | 'logistica' | 'post_sincronizacion';
export type EstadoAlerta = 'abierta' | 'pendiente_respuesta' | 'cerrada';
export type TipoMensajeAlerta = 'respuesta' | 'complemento' | 'consulta' | 'cierre' | 'reapertura';

export interface AlertaFila {
  id: string;
  tipo: TipoAlerta;
  categoria: string | null;
  estado: EstadoAlerta;
  origen: 'usuario' | 'sistema';
  titulo: string;
  afecta_cronograma: boolean;
  creado_en: string;
  hora_dispositivo: string | null;
  actualizado_en: string;
  brigada_id: string | null;
  brigada_nombre: string | null;
  estacion_id: string | null;
  estacion_codigo: string | null;
  ejecucion_id: string | null;
  autor_nombre: string | null;
}

export interface MensajeAlerta {
  id: string;
  tipo: TipoMensajeAlerta;
  texto: string;
  creado_en: string;
  autor_id: string;
  autor_nombre: string;
}

export interface AlertaDetalle extends AlertaFila {
  proyecto_id: string;
  descripcion: string | null;
  metodo_nombre: string | null;
  reserva_id: string | null;
  cerrado_en: string | null;
  cerrado_por_nombre: string | null;
  cierre_comentario: string | null;
  mensajes: MensajeAlerta[];
  /** Pista para la interfaz; la API vuelve a autorizar cada acción. */
  permisos: {
    puede_responder: boolean;
    puede_consultar: boolean;
    puede_cerrar: boolean;
    puede_reabrir: boolean;
  };
}
