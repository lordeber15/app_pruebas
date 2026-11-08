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

const sinConexion = () =>
  new ErrorApi(
    0,
    'SIN_CONEXION',
    'No hay conexión con el servidor. Revise su red e intente de nuevo.',
  );

const errorDe = async (r: Response): Promise<ErrorApi> => {
  let p: { detail?: string; codigo?: string } = {};
  try {
    p = (await r.json()) as typeof p;
  } catch {
    // Sin cuerpo RFC 9457: se usa el mensaje genérico.
  }
  return new ErrorApi(
    r.status,
    p.codigo ?? 'ERROR',
    p.detail ?? 'La solicitud no se pudo completar.',
  );
};

/** Sube un archivo como multipart/form-data (el navegador pone el límite). */
const subir = async <T>(ruta: string, campo: string, archivo: File): Promise<T> => {
  const datos = new FormData();
  datos.append(campo, archivo, archivo.name);
  let r: Response;
  try {
    r = await fetch(`/api/v1${ruta}`, { method: 'POST', credentials: 'include', body: datos });
  } catch {
    throw sinConexion();
  }
  if (!r.ok) throw await errorDe(r);
  return (await r.json()) as T;
};

/** Descarga un archivo de la API y lo guarda con el nombre que indica el servidor. */
const descargar = async (ruta: string, nombrePorDefecto: string): Promise<void> => {
  let r: Response;
  try {
    r = await fetch(`/api/v1${ruta}`, { credentials: 'include' });
  } catch {
    throw sinConexion();
  }
  if (!r.ok) throw await errorDe(r);
  const nombre =
    /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? nombrePorDefecto;
  const url = URL.createObjectURL(await r.blob());
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
};

export const api = {
  subir,
  descargar,
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
  /** Decisión del proyecto, además de las fotos de D01. */
  fotos_minimas_ejecucion: number;
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
  /** CONDICIONAL que esperan confirmación nominal (P-01). */
  metodos_pendientes: number;
}

// ── Métodos a ejecutar por estación (RN-28, P-01) ──

export type ClaseMetodo = 'todas' | 'condicional' | 'evento' | 'atributo' | 'transversal';
export type EstadoMatriz =
  'aplicable' | 'condicion_pendiente' | 'no_aplica' | 'descartado' | 'evento' | 'atributo';
export type TipoControl =
  'obligatorio' | 'advertencia' | 'informativo' | 'referencia' | 'criterio_humano';

export interface MetodoDeEstacion {
  metodo_id: string;
  codigo: string;
  nombre: string;
  clase: ClaseMetodo;
  estado: EstadoMatriz;
  origen: 'clase' | 'condicion' | 'nominal' | null;
  condicion_d01: string;
  resumen_d01:
    { clave: string; etiqueta: string; valor: string; tipo_control: TipoControl | null }[] | null;
  reserva: { id: string; estado: string } | null;
  ejecuciones: number;
  admite_decision: boolean;
  decision: { decision: 'confirmar' | 'descartar'; motivo: string; por: string; en: string } | null;
  actualizado_en: string | null;
}

export interface MetodosDeEstacion {
  estacion: {
    id: string;
    codigo: string;
    region: string | null;
    uv: string | null;
    za_ef: string | null;
  };
  puede_decidir: boolean;
  pendientes: number;
  especialidades: { id: string | null; nombre: string; metodos: MetodoDeEstacion[] }[];
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
  | { tipo: 'marcar'; item_id: string; estado_fila: EstadoFilaCronograma }
  | {
      tipo: 'agregar';
      item: {
        id: string;
        brigada_id: string;
        fecha: string;
        tipo_actividad: string;
        estacion_id: string | null;
        detalle: string | null;
        actividad_especial: string | null;
      };
    };

/** Fila del borrador del cronograma base (proyecto sin A01, antes de publicarlo). */
export interface FilaBorrador {
  id: string;
  brigada_id: string;
  brigada_codigo: string | null;
  brigada_nombre: string;
  fecha: string;
  tipo_actividad: string;
  estacion_id: string | null;
  estacion_codigo: string | null;
  detalle: string | null;
}

export interface Borrador {
  publicado: boolean;
  filas: FilaBorrador[];
}

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

// ── Avance por estación (métodos completos / aplicables) ──

export type EstadoEstacion =
  'con_incumplimiento' | 'completa' | 'en_curso' | 'reprogramada' | 'sin_datos' | 'sin_iniciar';

export interface EstacionAvance {
  id: string;
  codigo: string;
  lat: number;
  lon: number;
  za_ef: string | null;
  brigada_id: string | null;
  brigada: string | null;
  fecha_programada: string | null;
  reprogramada: boolean;
  avance: {
    completos: number;
    aplicables: number;
    porcentaje: number | null;
    estado: EstadoEstacion;
  };
  metodos: {
    metodo_id: string;
    metodo_codigo: string;
    metodo_nombre: string;
    especialidad_nombre: string;
    porcentaje: number | null;
    completo: boolean;
    ejecuciones: number;
  }[];
}

export interface AvanceEstaciones {
  generado_en: string;
  hoy: string;
  estaciones: EstacionAvance[];
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
  /** Coordenada y precisión GPS de la captura (F-02); null si el celular no la tenía. */
  lat: number | null;
  lon: number | null;
  precision_m: number | null;
  /** URL firmada (≤ 15 min) de la miniatura; null si el worker aún no la generó. */
  miniatura_url: string | null;
  puede_marcar: boolean;
}

/** Una página de la galería; `siguiente` es el cursor de la próxima o null si no hay más. */
export interface Galeria {
  fotos: FotoGaleria[];
  siguiente: string | null;
  puede_seleccionar: boolean;
}

/** Agregado por estación para el mini mapa de la galería. */
export interface EstacionGaleria {
  estacion_id: string;
  codigo: string;
  lat: number;
  lon: number;
  fotos: number;
}

/** Una foto de la estación en su coordenada GPS, para el mapa de la galería (sin URL). */
export interface PuntoGaleria {
  archivo_id: string;
  ejecucion_id: string;
  lat: number;
  lon: number;
  precision_m: number | null;
  capturado_en: string;
  tipo_foto: string | null;
  estacion_codigo: string;
  metodo_nombre: string;
  unidad_codigo: string | null;
  usuario_nombre: string;
}

/** Puntos de una estación; `truncado` si superan el tope del servidor. */
export interface PuntosGaleria {
  puntos: PuntoGaleria[];
  truncado: boolean;
  sin_coordenada: number;
}

// ── Configuración por método D01 por plantilla Excel (RF-W09) ──

export interface ConfiguracionD01 {
  vigente: {
    numero: number;
    origen: string;
    notas: string | null;
    creado_en: string;
    creado_por_nombre: string | null;
    metodos: number;
  } | null;
  importaciones: {
    id: string;
    estado: 'vista_previa' | 'aplicada';
    archivo_nombre: string;
    con_errores: boolean;
    creado_en: string;
    creado_por_nombre: string;
    aplicado_en: string | null;
    aplicado_por_nombre: string | null;
    motivo: string | null;
    version_numero: number | null;
  }[];
}

export interface ErrorCeldaD01 {
  hoja: string;
  fila: number | null;
  columna: string | null;
  mensaje: string;
}

export interface ImportacionD01 {
  id: string;
  estado: 'vista_previa' | 'aplicada';
  archivo_nombre: string;
  con_errores: boolean;
  aplicable: boolean;
  creado_en: string;
  version_base: number | null;
  resumen: {
    nuevos: number;
    cambiados: number;
    sin_cambio: number;
    no_incluidos: number;
    errores: number;
  };
  metodos: {
    codigo: string;
    nombre: string;
    fila: number;
    estado: 'nuevo' | 'cambiado' | 'sin_cambio';
    cambios: { campo: string; antes: string; despues: string }[];
  }[];
  no_incluidos: { codigo: string; nombre: string }[];
  errores: ErrorCeldaD01[];
}

export interface ResultadoAplicacionD01 {
  configuracion_numero: number;
  metodos: number;
  estacion_metodo: number;
  estacion_metodo_pendientes: number;
  nominales_trasladadas: number;
  reservas_trasladadas: number;
  reservas_creadas: number;
}
