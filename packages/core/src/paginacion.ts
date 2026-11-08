import { z } from 'zod';

/**
 * Paginación de las listas de la web. Mismo esquema en la API (validación de la query) y en la
 * web (tamaño de página y forma de la respuesta).
 *
 * - Listas que crecen sin límite (ejecuciones, alertas, revisiones): **cursor** estable sobre
 *   (orden, id). El cursor es opaco para el cliente: lo arma y lo valida la API.
 * - Catálogos acotados que la web necesita completos por otras razones (estaciones para el mapa,
 *   usuarios para sumar a una brigada, dispositivos, solicitudes y actividades del cronograma):
 *   se paginan en el cliente sobre los datos ya cargados, con el mismo tamaño de página.
 */
export const LIMITE_PAGINA_POR_DEFECTO = 25;
export const LIMITE_PAGINA_MAXIMO = 100;

export const consultaPaginaSchema = z.object({
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITE_PAGINA_MAXIMO)
    .default(LIMITE_PAGINA_POR_DEFECTO),
  cursor: z.string().min(1).max(512).optional(),
});
export type ConsultaPagina = z.infer<typeof consultaPaginaSchema>;

/** Campo común de toda respuesta paginada: `null` cuando no hay más páginas. */
export const respuestaPaginaSchema = z.object({
  siguiente_cursor: z.string().nullable(),
});
export type RespuestaPagina = z.infer<typeof respuestaPaginaSchema>;
