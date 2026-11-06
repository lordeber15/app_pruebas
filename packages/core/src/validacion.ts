/**
 * Validación efectiva de una tarea (RN-06, CP-036): el cuaderno prevalece sobre el proyecto;
 * `null` en el cuaderno significa que hereda el valor del proyecto.
 */
export const validacionEfectiva = (
  cuadernoValidacionActiva: boolean | null,
  proyectoValidacionActiva: boolean,
): boolean => cuadernoValidacionActiva ?? proyectoValidacionActiva;
