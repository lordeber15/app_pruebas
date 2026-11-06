/**
 * Esfuerzo compartido (RN-19): el total de una metodología es la suma de las filas por
 * usuario. Nunca se guarda ni se sobrescribe un contador.
 */
export interface RegistroEsfuerzo {
  readonly estacionMetodologiaId: string;
  readonly usuarioId: string;
  readonly cantidad: number;
}

const cantidadValida = (cantidad: number): boolean => Number.isFinite(cantidad) && cantidad >= 0;

export const totalEsfuerzo = (
  registros: readonly RegistroEsfuerzo[],
  estacionMetodologiaId: string,
): number =>
  registros
    .filter((r) => r.estacionMetodologiaId === estacionMetodologiaId && cantidadValida(r.cantidad))
    .reduce((suma, r) => suma + r.cantidad, 0);

export const esfuerzoPorUsuario = (
  registros: readonly RegistroEsfuerzo[],
  estacionMetodologiaId: string,
): ReadonlyMap<string, number> => {
  const porUsuario = new Map<string, number>();
  for (const r of registros) {
    if (r.estacionMetodologiaId !== estacionMetodologiaId || !cantidadValida(r.cantidad)) continue;
    porUsuario.set(r.usuarioId, (porUsuario.get(r.usuarioId) ?? 0) + r.cantidad);
  }
  return porUsuario;
};

export interface AvanceEsfuerzo {
  readonly total: number;
  readonly meta: number | null;
  /** Porcentaje de la meta (0–100, sin tope superior si se excede); `null` si no hay meta. */
  readonly porcentaje: number | null;
}

export const avanceEsfuerzo = (total: number, meta: number | null): AvanceEsfuerzo => ({
  total,
  meta,
  porcentaje: meta === null || meta <= 0 ? null : Math.round((total / meta) * 1000) / 10,
});
