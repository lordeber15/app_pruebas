import { LIMITE_PAGINA_POR_DEFECTO } from '@campo/core';
import { useState } from 'react';

/**
 * Paginación de las listas largas de la web.
 *
 * - Por cursor (`usePaginaCursor`): ejecuciones, alertas y revisiones crecen sin límite y la API
 *   las entrega de a una página con `siguiente_cursor`. Se guarda la pila de cursores visitados
 *   para volver atrás; no hay total (contar toda la tabla no es barato), así que se muestra
 *   «Página N».
 * - En el cliente (`usePaginaCliente`): catálogos acotados que la página ya carga completos por
 *   otras razones (el mapa de estaciones, el selector de usuarios, el cronograma). Se muestra
 *   «X–Y de Z».
 *
 * Cambiar un filtro vuelve a la primera página: la clave de los filtros forma parte del estado.
 */

const claseBoton =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-linea bg-hoja px-4 text-sm font-semibold text-tinta hover:border-tinta-suave disabled:cursor-not-allowed disabled:opacity-50';

export const Paginacion = ({
  etiqueta,
  texto,
  hayAnterior,
  haySiguiente,
  alAnterior,
  alSiguiente,
  cargando = false,
}: {
  /** Qué se pagina, para el `aria-label` del `nav` (p. ej. «Páginas de ejecuciones»). */
  etiqueta: string;
  texto: string;
  hayAnterior: boolean;
  haySiguiente: boolean;
  alAnterior: () => void;
  alSiguiente: () => void;
  cargando?: boolean;
}) => {
  if (!hayAnterior && !haySiguiente) return null;
  return (
    <nav aria-label={etiqueta} className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <button type="button" className={claseBoton} disabled={!hayAnterior} onClick={alAnterior}>
        <span aria-hidden="true">←</span>&nbsp;Anterior
      </button>
      <p className="cifras text-sm text-tinta-suave" aria-live="polite" aria-busy={cargando}>
        {cargando ? `${texto} · cargando…` : texto}
      </p>
      <button
        type="button"
        className={claseBoton}
        disabled={!haySiguiente || cargando}
        onClick={alSiguiente}
      >
        Siguiente&nbsp;<span aria-hidden="true">→</span>
      </button>
    </nav>
  );
};

/** Estado de una lista paginada por cursor; `clave` resume los filtros vigentes. */
export const usePaginaCursor = (clave: string) => {
  const [estado, setEstado] = useState<{ clave: string; pila: readonly string[] }>({
    clave,
    pila: [],
  });
  // Si cambiaron los filtros, la pila guardada ya no vale: se vuelve a la primera página.
  const pila = estado.clave === clave ? estado.pila : [];
  const cursor = pila.at(-1);
  return {
    /** Cursor de la página actual (`undefined` en la primera). */
    cursor,
    pagina: pila.length + 1,
    /** Parámetro para la query de la API («&cursor=…» o vacío). */
    parametro: cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`,
    props: (siguiente: string | null | undefined, cargando: boolean) => ({
      texto: `Página ${String(pila.length + 1)}`,
      hayAnterior: pila.length > 0,
      haySiguiente: siguiente != null,
      cargando,
      alAnterior: () => setEstado({ clave, pila: pila.slice(0, -1) }),
      alSiguiente: () => {
        if (siguiente != null) setEstado({ clave, pila: [...pila, siguiente] });
      },
    }),
  };
};

/** Paginación en el cliente sobre una lista ya cargada. */
export const usePaginaCliente = <T,>(
  items: readonly T[],
  clave = '',
  tamano: number = LIMITE_PAGINA_POR_DEFECTO,
) => {
  const [estado, setEstado] = useState({ clave, indice: 0 });
  const paginas = Math.max(1, Math.ceil(items.length / tamano));
  // Vuelve a la primera con otros filtros; si la lista se achicó, se queda en la última.
  const indice = Math.min(estado.clave === clave ? estado.indice : 0, paginas - 1);
  const desde = indice * tamano;
  const visibles = items.slice(desde, desde + tamano);
  return {
    visibles,
    props: {
      texto:
        items.length === 0
          ? '0 de 0'
          : `${String(desde + 1)}–${String(desde + visibles.length)} de ${String(items.length)}`,
      hayAnterior: indice > 0,
      haySiguiente: indice < paginas - 1,
      alAnterior: () => setEstado({ clave, indice: indice - 1 }),
      alSiguiente: () => setEstado({ clave, indice: indice + 1 }),
    },
  };
};
