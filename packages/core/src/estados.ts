// Valores de estado compartidos por core, la API y los CHECK de la base de datos (doc. 02 §7 y §8).

const incluye =
  <T extends string>(valores: readonly T[]) =>
  (x: string): x is T =>
    (valores as readonly string[]).includes(x);

/**
 * Reserva estación × método (interna): la crea la carga de D01/A01 para la brigada y la fecha del
 * cronograma vigente. `asignada` si tiene brigada; si no, `pendiente`. No se retiene por
 * dispositivo: cada especialista abre su propia ejecución (RN-19). `descartada`: Coordinación o
 * el JdP descartaron el método CONDICIONAL en la estación; la reserva no se borra (nada se
 * borra), deja de ir al celular y no cuenta en el avance. Si se vuelve a confirmar, se reactiva.
 */
export const ESTADOS_RESERVA = ['pendiente', 'asignada', 'descartada'] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

export const ESTADOS_EVENTO = [
  'aplicado',
  'ya_aplicado',
  'no_aplicado',
  'en_revision',
  'duplicado',
  'resuelto_elegido',
  'resuelto_descartado',
] as const;
export type EstadoEvento = (typeof ESTADOS_EVENTO)[number];

export const ESTADOS_ARCHIVO = [
  'anunciado',
  'preview_subida',
  'preview_verificada',
  'original_verificado',
  'error',
] as const;
export type EstadoArchivo = (typeof ESTADOS_ARCHIVO)[number];

export const TIPOS_ARCHIVO = ['foto', 'ficha', 'audio', 'comprobante'] as const;
export type TipoArchivo = (typeof TIPOS_ARCHIVO)[number];

/**
 * Roles TOCE (ERS §2.2, D02 §5). En la brigada: especialista, supervisor de campo (especialista
 * con permiso adicional) y jefe de brigada (logístico). Globales: coordinación, jefe de proyecto y
 * administrador técnico. Gabinete queda pendiente (P-14) y no tiene permisos.
 */
export const ROLES_BRIGADA = ['especialista', 'supervisor_campo', 'jefe_brigada'] as const;
export type RolBrigada = (typeof ROLES_BRIGADA)[number];

export const ROLES_GLOBALES = ['coordinacion', 'jefe_proyecto', 'admin'] as const;
export type RolGlobal = (typeof ROLES_GLOBALES)[number];

export const ROLES = [...ROLES_BRIGADA, ...ROLES_GLOBALES] as const;
export type Rol = (typeof ROLES)[number];

/** Rol global guardado en `usuario.rol_global`: `ninguno` si solo tiene roles de brigada. */
export const VALORES_ROL_GLOBAL = [...ROLES_GLOBALES, 'ninguno'] as const;
export type ValorRolGlobal = (typeof VALORES_ROL_GLOBAL)[number];

// ── Modelo TOCE (ERS v4.0 §2, D02 §6, §9 y §10) ─────────────────────────────────────────────

/** Ejecución de un método en una estación (RN-05, RN-31). Estados del servidor. */
export const ESTADOS_EJECUCION = [
  'en_curso',
  'evidencia_pendiente',
  'completa',
  'parcial',
  'validada',
  'observada',
] as const;
export type EstadoEjecucion = (typeof ESTADOS_EJECUCION)[number];

/** Desviación declarada por el especialista (RF-M11, E-06). */
export const TIPOS_DESVIACION = ['ninguna', 'parcial', 'imposibilidad', 'excepcional'] as const;
export type TipoDesviacion = (typeof TIPOS_DESVIACION)[number];

export const ESTADOS_UNIDAD = ['abierta', 'cerrada'] as const;
export type EstadoUnidad = (typeof ESTADOS_UNIDAD)[number];

/** Alertas (RN-36): tres tipos y estados mínimos. */
export const TIPOS_ALERTA = ['tecnica', 'logistica', 'post_sincronizacion'] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

/** Tipos que se registran desde campo o la web; las post-sincronización las genera el sistema. */
export const TIPOS_ALERTA_REGISTRABLES = ['tecnica', 'logistica'] as const;
export type TipoAlertaRegistrable = (typeof TIPOS_ALERTA_REGISTRABLES)[number];

/**
 * Categorías de una alerta logística del JdB (D02 §9, D04 §10, E-07): solo excepciones.
 * La lista de ítems del checklist sigue pendiente (P-09); estas categorías vienen de D02.
 */
export const CATEGORIAS_ALERTA_LOGISTICA = [
  'movilidad',
  'materiales',
  'hospedaje',
  'apoyo_local',
  'epp_documentos',
  'viaticos',
  'muestras_equipos',
] as const;
export type CategoriaAlertaLogistica = (typeof CATEGORIAS_ALERTA_LOGISTICA)[number];
/** Textos de D02 §9 para la interfaz (web y móvil). */
export const ETIQUETA_CATEGORIA_LOGISTICA: Readonly<Record<CategoriaAlertaLogistica, string>> = {
  movilidad: 'Movilidad',
  materiales: 'Materiales',
  hospedaje: 'Hospedaje',
  apoyo_local: 'Apoyo local',
  epp_documentos: 'EPP / documentos',
  viaticos: 'Viáticos',
  muestras_equipos: 'Muestras / equipos',
};

export const ESTADOS_ALERTA = ['abierta', 'pendiente_respuesta', 'cerrada'] as const;
export type EstadoAlerta = (typeof ESTADOS_ALERTA)[number];
/** Estado solo del celular antes de sincronizar (D02 §9); nunca llega al servidor. */
export const ESTADO_ALERTA_LOCAL = 'pendiente_sync' as const;

export const ORIGENES_ALERTA = ['usuario', 'sistema'] as const;
export type OrigenAlerta = (typeof ORIGENES_ALERTA)[number];

export const TIPOS_MENSAJE_ALERTA = [
  'respuesta',
  'complemento',
  'consulta',
  'cierre',
  'reapertura',
] as const;
export type TipoMensajeAlerta = (typeof TIPOS_MENSAJE_ALERTA)[number];

/** Cronograma (RN-35): versión base inmutable y versiones vigentes sucesivas. */
export const ESTADOS_CRONOGRAMA_VERSION = ['vigente', 'historica'] as const;
export type EstadoCronogramaVersion = (typeof ESTADOS_CRONOGRAMA_VERSION)[number];

export const ESTADOS_SOLICITUD_CRONOGRAMA = [
  'pendiente',
  'aprobada',
  'rechazada',
  'ajuste_solicitado',
] as const;
export type EstadoSolicitudCronograma = (typeof ESTADOS_SOLICITUD_CRONOGRAMA)[number];

/** Tipos de actividad del cronograma, tal como vienen en A01. */
export const TIPOS_ACTIVIDAD_CRONOGRAMA = [
  'estacion',
  'movilizacion',
  'traslado',
  'desmovilizacion',
  'feriado',
  'procesamiento',
  'otro',
] as const;
export type TipoActividadCronograma = (typeof TIPOS_ACTIVIDAD_CRONOGRAMA)[number];

/** Estado de cada fila del cronograma: una estación no ejecutada nunca desaparece (RN-35). */
export const ESTADOS_FILA_CRONOGRAMA = [
  'ok',
  'pendiente_validacion',
  'reprogramada',
  'sujeta_a_decision',
] as const;
export type EstadoFilaCronograma = (typeof ESTADOS_FILA_CRONOGRAMA)[number];

export const TIPOS_BRIGADA = ['regular', 'complementaria', 'especial'] as const;
export type TipoBrigada = (typeof TIPOS_BRIGADA)[number];

/** Tipos de fotografía (D01 hoja 02, F-01 a F-05) y orientación cardinal (F-03). */
export const TIPOS_FOTO = ['contexto', 'metodologica', 'primer_plano', 'cientifica'] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];

export const ORIENTACIONES = ['N', 'S', 'E', 'O'] as const;
export type Orientacion = (typeof ORIENTACIONES)[number];

export const AID_AII = ['AID', 'AII'] as const;
export type AidAii = (typeof AID_AII)[number];

export const esEstadoEjecucion = incluye(ESTADOS_EJECUCION);
export const esEstadoAlerta = incluye(ESTADOS_ALERTA);
export const esEstadoSolicitudCronograma = incluye(ESTADOS_SOLICITUD_CRONOGRAMA);

/** Guardas para valores que llegan de la base de datos como texto. */
export const esEstadoReserva = incluye(ESTADOS_RESERVA);
export const esRolBrigada = incluye(ROLES_BRIGADA);
export const esRolGlobal = incluye(ROLES_GLOBALES);
export const esEstadoArchivo = incluye(ESTADOS_ARCHIVO);
