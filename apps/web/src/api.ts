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

export type EstadoTarea =
  | 'pendiente'
  | 'asignada'
  | 'descargada'
  | 'en_transito'
  | 'completada'
  | 'validada'
  | 'observada'
  | 'cerrada';

export interface Yo {
  id: string;
  nombre: string;
  tipo_documento: string;
  num_documento: string;
  rol_global: 'supervisor' | 'admin' | 'ninguno';
  cuadrillas_jefe: string[];
  membresias: { cuadrilla_id: string; rol: string }[];
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

export interface Cuadrilla {
  id: string;
  nombre: string;
  jefe_id: string | null;
  jefe_nombre: string | null;
}

export interface Miembro {
  id: string;
  usuario_id: string;
  rol: 'especialista' | 'logistico';
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
  rol_global: 'supervisor' | 'admin' | 'ninguno';
  estado: 'activo' | 'inactivo';
}

export interface Cuaderno {
  id: string;
  titulo: string;
  cuadrilla_id: string;
  cuadrilla_nombre: string;
  responsable_id: string;
  responsable_nombre: string;
  validacion_activa: boolean | null;
  estado: string;
  tareas: string | null;
}

export interface FilaTarea {
  id: string;
  titulo: string;
  estado: EstadoTarea;
  origen: 'manual' | 'regla';
  tipo: 'tecnica' | 'logistica';
  actualizado_en: string;
  cuaderno_titulo: string;
  cuadrilla_nombre: string;
  responsable_nombre: string;
  lat: number | null;
  lon: number | null;
}

export interface Estacion {
  id: string;
  codigo: string;
  lat: number;
  lon: number;
  metodologias: {
    id: string;
    metodologia_id: string;
    nombre: string;
    meta_esfuerzo: string | null;
  }[];
}

export interface Metodologia {
  id: string;
  nombre: string;
  unidad: string;
  requiere_transecto: boolean;
}

export interface DetalleTarea {
  tarea: {
    id: string;
    titulo: string;
    descripcion: string | null;
    estado: EstadoTarea;
    origen: 'manual' | 'regla';
    tipo: 'tecnica' | 'logistica';
    proyecto_id: string;
    cuaderno_id: string;
    cuaderno_titulo: string;
    cuadrilla_nombre: string;
    responsable_nombre: string;
    estacion_codigo: string | null;
    metodologia_nombre: string | null;
    validacion_activa: boolean;
    lat: number | null;
    lon: number | null;
    creado_en: string;
  };
  asignaciones: {
    id: string;
    estado: string;
    descargada_en: string;
    finalizada_en: string | null;
    motivo_revocacion: string | null;
    usuario_nombre: string;
  }[];
  archivos: {
    id: string;
    tipo: string;
    estado: string;
    capturado_en: string;
    precision_m: number | null;
    lat: number | null;
    lon: number | null;
    tiene_miniatura: boolean;
  }[];
  comentarios: { id: string; texto: string; creado_en: string; autor_nombre: string }[];
  eventos: {
    id: string;
    tipo: string;
    estado: string;
    motivo: string | null;
    hora_servidor: string;
    usuario_nombre: string;
  }[];
  evidencias: { id: string; descripcion: string; orden: number }[];
  permisos: { gestionar: boolean; comentar: boolean };
}

export interface Avance {
  cuadrillas: { id: string; nombre: string; estados: Partial<Record<EstadoTarea, number>> }[];
  esfuerzo: {
    id: string;
    estacion: string;
    metodologia: string;
    unidad: string;
    total: number;
    meta: number | null;
  }[];
}

export interface Revision {
  id: string;
  tipo: string;
  estado: 'en_revision' | 'duplicado';
  motivo: string | null;
  hora_servidor: string;
  tarea_id: string;
  tarea_titulo: string;
  usuario_nombre: string;
}
