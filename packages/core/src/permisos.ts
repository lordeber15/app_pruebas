import type { Rol, TipoAlerta } from './estados.ts';

/**
 * Matriz de permisos de la ERS §2.3 (modelo TOCE, D02 §5, D04 §7). Es la fuente de la prueba de
 * matriz (`pnpm test:authz`) y de la autorización de la API.
 *
 * - `total`: permitido en todo su ámbito.
 * - `alcance`: solo dentro de su ámbito (su brigada, su estación o lo suyo).
 * - `ver`: solo lectura.
 * - `no`: no permitido.
 *
 * El alcance concreto (proyecto, brigada, propiedad) lo verifica la API contra la base de datos.
 */
export type NivelPermiso = 'total' | 'alcance' | 'ver' | 'no';

export const ACCIONES = [
  /** Proyecto, campaña, brigadas, estaciones, aplicabilidad, cronograma base y reglas (web) ¹. */
  'configurar_proyecto',
  /** Cargar D01/A01 y editar la matriz estación–método ¹. */
  'cargar_configuracion',
  /** Usuarios, roles, dispositivos y baja remota ¹. */
  'administrar_usuarios',
  'descargar_paquete',
  /** Ejecutar métodos; datos, geometrías, tracks y fotos; cerrar ejecución; declarar desviación. */
  'ejecutar_metodos',
  /** Complementar y gestionar desviaciones técnico-metodológicas de la brigada. */
  'gestionar_desviaciones',
  /** Checklist por excepción, viáticos y comprobantes, muestras y equipos. */
  'registrar_incidencia_logistica',
  /** Alerta desde campo; el tipo permitido depende del rol (`tiposDeAlerta`). */
  'registrar_alerta',
  'responder_alertas',
  'cerrar_alertas',
  'proponer_reprogramacion',
  'aprobar_cronograma',
  /** Solo si la validación humana está activa (C1 [PEND]). */
  'validar_ejecuciones',
  /** Dashboard, mapa, galería, alertas y cronograma. */
  'consultar_seguimiento',
  'marcar_candidata',
  /** Seleccionar fotos finales, revisar y emitir el reporte diario. */
  'emitir_reporte_diario',
  'exportar',
  /** [PEND P-14]: nadie hasta que se defina el rol de gabinete. */
  'sistematizar',
  /** [DTP] Decidir qué se conserva de un evento en revisión o duplicado (RN-08, RN-13). */
  'resolver_revisiones',
] as const;
export type Accion = (typeof ACCIONES)[number];

type Fila = Readonly<Record<Rol, NivelPermiso>>;
const fila = (
  especialista: NivelPermiso,
  supervisor_campo: NivelPermiso,
  jefe_brigada: NivelPermiso,
  coordinacion: NivelPermiso,
  jefe_proyecto: NivelPermiso,
  admin: NivelPermiso,
): Fila => ({ especialista, supervisor_campo, jefe_brigada, coordinacion, jefe_proyecto, admin });

const T = 'total';
const A = 'alcance';
const N = 'no';

// Columnas: Esp. · Sup. · JdB · Coord. · JdP · Admin (ERS §2.3).
export const MATRIZ_PERMISOS: Readonly<Record<Accion, Fila>> = {
  configurar_proyecto: fila(N, N, N, T, T, N),
  cargar_configuracion: fila(N, N, N, T, T, N),
  administrar_usuarios: fila(N, N, N, T, T, T),
  descargar_paquete: fila(A, A, A, A, A, N),
  ejecutar_metodos: fila(A, A, N, N, N, N),
  gestionar_desviaciones: fila(N, A, N, N, N, N),
  registrar_incidencia_logistica: fila(N, N, A, N, N, N),
  registrar_alerta: fila(A, A, A, T, T, N),
  responder_alertas: fila(A, A, A, T, T, N),
  cerrar_alertas: fila(N, N, N, T, T, N),
  proponer_reprogramacion: fila(N, N, N, T, T, N),
  aprobar_cronograma: fila(N, N, N, N, T, N),
  validar_ejecuciones: fila(N, A, N, T, T, N),
  consultar_seguimiento: fila(A, A, A, T, T, N),
  marcar_candidata: fila(A, A, N, T, T, N),
  emitir_reporte_diario: fila(N, N, N, T, T, N),
  exportar: fila(N, N, N, T, T, N),
  sistematizar: fila(N, N, N, N, N, N),
  resolver_revisiones: fila(N, N, N, T, T, N),
};

export const nivelPermiso = (rol: Rol, accion: Accion): NivelPermiso =>
  MATRIZ_PERMISOS[accion][rol];

/** `true` si el rol puede intentar la acción; con `alcance` la API debe verificar además el alcance. */
export const puedeIntentar = (rol: Rol, accion: Accion): boolean =>
  nivelPermiso(rol, accion) !== 'no';

/** Acciones que modifican: `ver` no basta. */
export const puedeModificar = (rol: Rol, accion: Accion): boolean => {
  const nivel = nivelPermiso(rol, accion);
  return nivel === 'total' || nivel === 'alcance';
};

/**
 * Tipos de alerta que cada rol registra desde campo (ERS §2.3): especialista y supervisor,
 * técnicas; jefe de brigada, logísticas; Coordinación y JdP, cualquiera. Las post-sincronización
 * las genera solo el sistema.
 */
export const tiposDeAlerta = (rol: Rol): readonly TipoAlerta[] => {
  switch (rol) {
    case 'especialista':
    case 'supervisor_campo':
      return ['tecnica'];
    case 'jefe_brigada':
      return ['logistica'];
    case 'coordinacion':
    case 'jefe_proyecto':
      return ['tecnica', 'logistica'];
    case 'admin':
      return [];
  }
};
