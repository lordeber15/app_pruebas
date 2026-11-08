import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type FotoGaleria } from '../api.ts';
import { fechaHora } from './Ui.tsx';

export const TIPO_FOTO: Readonly<Record<string, string>> = {
  contexto: 'Contexto',
  metodologica: 'Metodológica',
  primer_plano: 'Primer plano',
  cientifica: 'Científica',
};

/** Texto alternativo completo: tipo, estación, método, unidad, fecha y autor. */
export const textoAlternativo = (f: FotoGaleria): string =>
  `${TIPO_FOTO[f.tipo_foto ?? ''] ?? 'Foto'} de la estación ${f.estacion_codigo}, ${f.metodo_nombre}` +
  (f.unidad_codigo === null ? '' : `, unidad ${f.unidad_codigo}`) +
  `, ${fechaHora(f.capturado_en)}, por ${f.usuario_nombre}`;

/**
 * Visor modal de la versión de 2 048 px (D02 §8). `<dialog>` nativo con `showModal()`: el resto
 * de la página queda inerte (foco atrapado) y Escape cierra. Flechas ← → y botones para pasar
 * de foto. La URL firmada (≤ 15 min, `inline`) se pide recién al abrir cada foto.
 *
 * Sin enlace de descarga, sin `href` a la imagen, sin menú contextual ni arrastre. Esto solo
 * disuade la descarga casual: no impide capturas de pantalla ni que alguien con las herramientas
 * del navegador copie la URL firmada mientras está vigente.
 */
export const VisorFoto = ({
  fotos,
  indice,
  alCambiar,
  alCerrar,
}: {
  fotos: readonly FotoGaleria[];
  /** Foto abierta; null = visor cerrado. */
  indice: number | null;
  alCambiar: (indice: number) => void;
  alCerrar: () => void;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const abierto = indice !== null;
  const foto = indice === null ? undefined : fotos[indice];

  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (abierto && !d.open) {
      d.showModal();
      cerrarRef.current?.focus();
    }
    if (!abierto && d.open) d.close();
  }, [abierto]);

  const anterior = indice !== null && indice > 0 ? indice - 1 : null;
  const siguiente = indice !== null && indice < fotos.length - 1 ? indice + 1 : null;

  return (
    <dialog
      ref={ref}
      onClose={alCerrar}
      aria-labelledby="titulo-visor"
      aria-describedby="detalle-visor"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' && anterior !== null) {
          e.preventDefault();
          alCambiar(anterior);
        }
        if (e.key === 'ArrowRight' && siguiente !== null) {
          e.preventDefault();
          alCambiar(siguiente);
        }
      }}
      className="m-auto h-[min(100dvh_-_2rem,56rem)] w-[min(100vw_-_2rem,80rem)] max-w-none overflow-hidden rounded-lg border border-linea bg-hoja p-0 text-tinta shadow-xl"
    >
      {foto === undefined || indice === null ? null : (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-linea px-4 py-2">
            <div className="min-w-0">
              <h2 id="titulo-visor" className="text-base font-semibold">
                Foto {indice + 1} de {fotos.length}
                <span className="font-normal text-tinta-suave"> (cargadas)</span>
              </h2>
              <p id="detalle-visor" className="text-sm text-tinta-suave">
                {textoAlternativo(foto)}
              </p>
            </div>
            <button
              ref={cerrarRef}
              type="button"
              onClick={alCerrar}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md border border-linea px-3 text-sm font-semibold hover:border-tinta-suave"
            >
              <span aria-hidden="true">✕</span> Cerrar
            </button>
          </div>
          <VistaGrande key={foto.id} foto={foto} />
          <div className="flex items-center justify-between gap-3 border-t border-linea px-4 py-2">
            <button
              type="button"
              disabled={anterior === null}
              onClick={() => anterior !== null && alCambiar(anterior)}
              className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-md border border-linea px-4 text-sm font-semibold hover:border-tinta-suave disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">←</span> Anterior
            </button>
            <p className="hidden text-xs text-tinta-suave sm:block">
              Use las flechas ← → del teclado; Escape cierra.
            </p>
            <button
              type="button"
              disabled={siguiente === null}
              onClick={() => siguiente !== null && alCambiar(siguiente)}
              className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-md border border-linea px-4 text-sm font-semibold hover:border-tinta-suave disabled:cursor-not-allowed disabled:opacity-50"
            >
              Siguiente <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
};

/** Versión de 2 048 px: la URL firmada se pide aquí, no en la grilla. */
const VistaGrande = ({ foto }: { foto: FotoGaleria }) => {
  const q = useQuery({
    queryKey: ['url-archivo', foto.id, 'preview'],
    queryFn: () => api.get<{ url: string }>(`/archivos/${foto.id}/url?variante=preview`),
    // La firma dura ≤ 15 min: se renueva antes de que venza.
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
  const [fallo, setFallo] = useState(false);
  const [cargada, setCargada] = useState(false);

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-tinta/90 p-2">
      {q.isPending ? (
        <p role="status" className="text-sm text-white">
          Cargando la foto…
        </p>
      ) : null}
      {q.isError || fallo ? (
        <div role="alert" className="flex flex-col items-center gap-2 text-sm text-white">
          <p>No se pudo mostrar la foto.</p>
          <button
            type="button"
            onClick={() => {
              setFallo(false);
              setCargada(false);
              void q.refetch();
            }}
            className="min-h-11 rounded-md border border-white px-4 font-semibold"
          >
            Reintentar
          </button>
        </div>
      ) : null}
      {q.data !== undefined && !fallo ? (
        <>
          {cargada ? null : (
            <p role="status" className="absolute text-sm text-white">
              Cargando la foto…
            </p>
          )}
          <img
            src={q.data.url}
            alt={textoAlternativo(foto)}
            decoding="async"
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            onLoad={() => setCargada(true)}
            onError={() => setFallo(true)}
            className="max-h-full max-w-full select-none object-contain"
          />
        </>
      ) : null}
    </div>
  );
};
