import { describe, expect, it } from 'vitest';
import { ROLES, type Rol } from './estados.ts';
import {
  ACCIONES,
  MATRIZ_PERMISOS,
  nivelPermiso,
  puedeIntentar,
  puedeModificar,
  tiposDeAlerta,
  type Accion,
} from './permisos.ts';

/**
 * Matriz de la ERS §2.3 transcrita tal cual: ✔ = total, ◐ = alcance, ✖ = no.
 * Columnas: Esp. · Sup. · JdB · Coord. · JdP · Admin.
 */
type Celda = '✔' | '◐' | '✖';
const ERS_2_3: Readonly<Record<Accion, readonly [Celda, Celda, Celda, Celda, Celda, Celda]>> = {
  configurar_proyecto: ['✖', '✖', '✖', '✔', '✔', '✖'],
  cargar_configuracion: ['✖', '✖', '✖', '✔', '✔', '✖'],
  administrar_usuarios: ['✖', '✖', '✖', '✔', '✔', '✔'],
  descargar_paquete: ['◐', '◐', '◐', '◐', '◐', '✖'],
  ejecutar_metodos: ['◐', '◐', '✖', '✖', '✖', '✖'],
  gestionar_desviaciones: ['✖', '◐', '✖', '✖', '✖', '✖'],
  registrar_incidencia_logistica: ['✖', '✖', '◐', '✖', '✖', '✖'],
  registrar_alerta: ['◐', '◐', '◐', '✔', '✔', '✖'],
  responder_alertas: ['◐', '◐', '◐', '✔', '✔', '✖'],
  cerrar_alertas: ['✖', '✖', '✖', '✔', '✔', '✖'],
  proponer_reprogramacion: ['✖', '✖', '✖', '✔', '✔', '✖'],
  aprobar_cronograma: ['✖', '✖', '✖', '✖', '✔', '✖'],
  validar_ejecuciones: ['✖', '◐', '✖', '✔', '✔', '✖'],
  consultar_seguimiento: ['◐', '◐', '◐', '✔', '✔', '✖'],
  marcar_candidata: ['◐', '◐', '✖', '✔', '✔', '✖'],
  emitir_reporte_diario: ['✖', '✖', '✖', '✔', '✔', '✖'],
  exportar: ['✖', '✖', '✖', '✔', '✔', '✖'],
  sistematizar: ['✖', '✖', '✖', '✖', '✖', '✖'],
  // [DTP] No está en la ERS: Coordinación y JdP, que revisan la QA post-sincronización.
  resolver_revisiones: ['✖', '✖', '✖', '✔', '✔', '✖'],
};

const SIMBOLO = { '✔': 'total', '◐': 'alcance', '✖': 'no' } as const;

const casos = ACCIONES.flatMap((accion) =>
  ROLES.map((rol, i) => [accion, rol, ERS_2_3[accion][i]] as const),
);

describe('matriz de permisos (ERS §2.3)', () => {
  it('las columnas siguen el orden de la ERS', () => {
    expect(ROLES).toEqual([
      'especialista',
      'supervisor_campo',
      'jefe_brigada',
      'coordinacion',
      'jefe_proyecto',
      'admin',
    ]);
  });

  it.each(casos)('%s · %s = %s', (accion, rol, simbolo) => {
    expect(simbolo).toBeDefined();
    expect(nivelPermiso(rol, accion)).toBe(SIMBOLO[simbolo as Celda]);
  });

  it('la matriz define todas las acciones para todos los roles', () => {
    for (const accion of ACCIONES) {
      expect(Object.keys(MATRIZ_PERMISOS[accion]).sort()).toEqual([...ROLES].sort());
    }
  });

  it('el Administrador técnico solo administra usuarios y dispositivos', () => {
    expect(ACCIONES.filter((a) => puedeIntentar('admin', a))).toEqual(['administrar_usuarios']);
  });

  it('RN-36 solo el Jefe de Proyecto aprueba cambios de cronograma', () => {
    expect(ROLES.filter((r: Rol) => puedeIntentar(r, 'aprobar_cronograma'))).toEqual([
      'jefe_proyecto',
    ]);
  });

  it('RN-36 cierran alertas Coordinación y el Jefe de Proyecto', () => {
    expect(ROLES.filter((r: Rol) => puedeModificar(r, 'cerrar_alertas'))).toEqual([
      'coordinacion',
      'jefe_proyecto',
    ]);
  });

  it('el Jefe de Brigada no ejecuta métodos (D04 §8: rol logístico independiente)', () => {
    expect(puedeIntentar('jefe_brigada', 'ejecutar_metodos')).toBe(false);
    expect(puedeIntentar('jefe_brigada', 'registrar_incidencia_logistica')).toBe(true);
  });

  it('P-14 nadie sistematiza hasta que se defina el rol de gabinete', () => {
    expect(ROLES.filter((r: Rol) => puedeIntentar(r, 'sistematizar'))).toEqual([]);
  });

  it('el tipo de alerta desde campo depende del rol (ERS §2.3)', () => {
    expect(tiposDeAlerta('especialista')).toEqual(['tecnica']);
    expect(tiposDeAlerta('supervisor_campo')).toEqual(['tecnica']);
    expect(tiposDeAlerta('jefe_brigada')).toEqual(['logistica']);
    expect(tiposDeAlerta('coordinacion')).toEqual(['tecnica', 'logistica']);
    expect(tiposDeAlerta('jefe_proyecto')).toEqual(['tecnica', 'logistica']);
    expect(tiposDeAlerta('admin')).toEqual([]);
  });
});
