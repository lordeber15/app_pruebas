import { describe, expect, it } from 'vitest';
import { ROLES, type Rol } from './estados.ts';
import {
  ACCIONES,
  MATRIZ_PERMISOS,
  nivelPermiso,
  puedeIntentar,
  puedeModificar,
  type Accion,
} from './permisos.ts';

/**
 * Matriz de doc. 01 §2.3 transcrita tal cual: ✔ = total, ◐ = alcance, ver, ✖ = no.
 * Columnas: supervisor, jefe, especialista, logístico, admin.
 */
const DOC_01: Readonly<Record<Accion, readonly [string, string, string, string, string]>> = {
  configurar_proyecto: ['✔', '✖', '✖', '✖', '✖'],
  gestionar_cuadrillas: ['✔', '✖', '✖', '✖', '✖'],
  gestionar_cuadernos_tareas: ['✔', '◐', '✖', '✖', '✖'],
  reasignar_tarea: ['✔', '◐', '✖', '✖', '✖'],
  revocar_asignacion: ['✔', '◐', '✖', '✖', '✖'],
  ejecutar_tareas: ['✖', '✖', '◐', '◐', '✖'],
  validar_tareas: ['✔', '◐', '✖', '✖', '✖'],
  reabrir_tareas: ['✔', '◐', '✖', '✖', '✖'],
  resolver_revisiones: ['✔', '◐', '✖', '✖', '✖'],
  comentar_tareas: ['✔', '◐', '◐', '◐', '✖'],
  lista_logistica: ['✔', '◐', 'ver', '◐', '✖'],
  sistematizar: ['✖', '✖', '◐', '✖', '✖'],
  ver_avance: ['✔', '◐', '◐', '◐', '✖'],
  generar_reportes: ['✔', '◐', '✖', '✖', '✖'],
  administrar_usuarios: ['✔', '✖', '✖', '✖', '✔'],
};

const SIMBOLO = { '✔': 'total', '◐': 'alcance', ver: 'ver', '✖': 'no' } as const;

const casos = ACCIONES.flatMap((accion) =>
  ROLES.map((rol, i) => [accion, rol, DOC_01[accion][i]] as const),
);

describe('matriz de permisos (doc. 01 §2.3)', () => {
  it.each(casos)('%s · %s = %s', (accion, rol, simbolo) => {
    expect(simbolo).toBeDefined();
    expect(nivelPermiso(rol, accion)).toBe(SIMBOLO[simbolo as keyof typeof SIMBOLO]);
  });

  it('la matriz define todas las acciones para todos los roles', () => {
    for (const accion of ACCIONES) {
      expect(Object.keys(MATRIZ_PERMISOS[accion]).sort()).toEqual([...ROLES].sort());
    }
  });

  it('el administrador solo administra usuarios y dispositivos', () => {
    const permitidas = ACCIONES.filter((a) => puedeIntentar('admin', a));
    expect(permitidas).toEqual(['administrar_usuarios']);
  });

  it('RN-21 solo el especialista sistematiza', () => {
    const roles = ROLES.filter((r: Rol) => puedeIntentar(r, 'sistematizar'));
    expect(roles).toEqual(['especialista']);
  });

  it('"ver" permite intentar pero no modificar', () => {
    expect(puedeIntentar('especialista', 'lista_logistica')).toBe(true);
    expect(puedeModificar('especialista', 'lista_logistica')).toBe(false);
    expect(puedeModificar('logistico', 'lista_logistica')).toBe(true);
  });
});
