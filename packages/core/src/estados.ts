// Valores de estado compartidos por core, la API y los CHECK de la base de datos (doc. 02 §7 y §8).

export const ESTADOS_TAREA = [
  'pendiente',
  'asignada',
  'descargada',
  'en_transito',
  'completada',
  'validada',
  'observada',
  'cerrada',
] as const;
export type EstadoTarea = (typeof ESTADOS_TAREA)[number];

export const ESTADOS_ASIGNACION = ['vigente', 'devuelta', 'revocada', 'finalizada'] as const;
export type EstadoAsignacion = (typeof ESTADOS_ASIGNACION)[number];

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

export const ORIGENES_TAREA = ['manual', 'regla'] as const;
export type OrigenTarea = (typeof ORIGENES_TAREA)[number];

export const TIPOS_TAREA = ['tecnica', 'logistica'] as const;
export type TipoTarea = (typeof TIPOS_TAREA)[number];

export const TIPOS_ARCHIVO = ['foto', 'ficha', 'audio', 'comprobante'] as const;
export type TipoArchivo = (typeof TIPOS_ARCHIVO)[number];

export const ROLES = ['supervisor', 'jefe', 'especialista', 'logistico', 'admin'] as const;
export type Rol = (typeof ROLES)[number];
