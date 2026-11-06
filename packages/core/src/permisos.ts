import type { Rol } from './estados';

/**
 * Matriz de permisos del doc. 01 §2.3 (⚑ C2: puede cambiar). Es la fuente de la prueba de
 * matriz (`pnpm test:authz`) y de la autorización de la API.
 *
 * - `total`: permitido en todo su ámbito.
 * - `alcance`: solo dentro de su alcance (jefe: su cuadrilla; especialista y logístico: lo suyo).
 * - `ver`: solo lectura.
 * - `no`: no permitido.
 *
 * El alcance concreto (proyecto, cuadrilla, propiedad) lo verifica la API contra la base de datos.
 */
export type NivelPermiso = 'total' | 'alcance' | 'ver' | 'no';

export const ACCIONES = [
  'configurar_proyecto',
  'gestionar_cuadrillas',
  'gestionar_cuadernos_tareas',
  'reasignar_tarea',
  'revocar_asignacion',
  'ejecutar_tareas',
  'validar_tareas',
  'reabrir_tareas',
  'resolver_revisiones',
  'comentar_tareas',
  'lista_logistica',
  'sistematizar',
  'ver_avance',
  'generar_reportes',
  'administrar_usuarios',
] as const;
export type Accion = (typeof ACCIONES)[number];

export const MATRIZ_PERMISOS: Readonly<Record<Accion, Readonly<Record<Rol, NivelPermiso>>>> = {
  configurar_proyecto: {
    supervisor: 'total',
    jefe: 'no',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  gestionar_cuadrillas: {
    supervisor: 'total',
    jefe: 'no',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  gestionar_cuadernos_tareas: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  reasignar_tarea: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  revocar_asignacion: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  // El logístico ejecuta solo tareas logísticas.
  ejecutar_tareas: {
    supervisor: 'no',
    jefe: 'no',
    especialista: 'alcance',
    logistico: 'alcance',
    admin: 'no',
  },
  validar_tareas: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  reabrir_tareas: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  resolver_revisiones: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  comentar_tareas: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'alcance',
    logistico: 'alcance',
    admin: 'no',
  },
  lista_logistica: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'ver',
    logistico: 'alcance',
    admin: 'no',
  },
  sistematizar: {
    supervisor: 'no',
    jefe: 'no',
    especialista: 'alcance',
    logistico: 'no',
    admin: 'no',
  },
  // En avance, mapa y galería, el especialista solo ve lo suyo, no lo de su cuadrilla.
  ver_avance: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'alcance',
    logistico: 'alcance',
    admin: 'no',
  },
  generar_reportes: {
    supervisor: 'total',
    jefe: 'alcance',
    especialista: 'no',
    logistico: 'no',
    admin: 'no',
  },
  administrar_usuarios: {
    supervisor: 'total',
    jefe: 'no',
    especialista: 'no',
    logistico: 'no',
    admin: 'total',
  },
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
