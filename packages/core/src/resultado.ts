export type Resultado<T, M extends string> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly motivo: M };

export const exito = <T>(valor: T): { readonly ok: true; readonly valor: T } => ({
  ok: true,
  valor,
});

export const fallo = <M extends string>(motivo: M): { readonly ok: false; readonly motivo: M } => ({
  ok: false,
  motivo,
});

/** Un texto obligatorio (motivo, comentario) no puede estar vacío ni ser solo espacios. */
export const tieneTexto = (texto: string | null | undefined): boolean =>
  texto !== null && texto !== undefined && texto.trim().length > 0;
