import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ErrorApi } from '../api.ts';

/** Fecha y hora en la zona horaria de quien mira (en el servidor todo es UTC). */
export const fechaHora = (iso: string | null | undefined): string =>
  iso == null
    ? '—'
    : new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      );

type Variante = 'principal' | 'secundario' | 'peligro' | 'atencion';

const ESTILO_BOTON: Readonly<Record<Variante, string>> = {
  principal: 'bg-liquen text-white hover:bg-liquen-oscuro',
  secundario: 'bg-hoja text-tinta border border-linea hover:border-tinta-suave',
  peligro: 'bg-oxido text-white hover:brightness-90',
  atencion: 'bg-ocre text-white hover:brightness-90',
};

export const Boton = ({
  children,
  variante = 'principal',
  ocupado = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; ocupado?: boolean }) => (
  <button
    type="button"
    {...props}
    disabled={props.disabled === true || ocupado}
    aria-busy={ocupado}
    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${ESTILO_BOTON[variante]} ${props.className ?? ''}`}
  >
    {ocupado ? 'Guardando…' : children}
  </button>
);

export const Campo = ({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: (id: string) => ReactNode;
}) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {etiqueta}
      </label>
      {children(id)}
      {ayuda === undefined ? null : <p className="text-xs text-tinta-suave">{ayuda}</p>}
    </div>
  );
};

export const claseEntrada =
  'min-h-11 w-full rounded-md border border-linea bg-hoja px-3 text-base text-tinta placeholder:text-tinta-suave focus:border-liquen';

export const AvisoError = ({ error }: { error: unknown }) => {
  if (error == null) return null;
  const texto =
    error instanceof ErrorApi ? error.message : 'Ocurrió un error inesperado. Intente de nuevo.';
  return (
    <p
      role="alert"
      className="rounded-md border border-oxido bg-oxido-claro px-3 py-2 text-sm text-oxido"
    >
      <strong className="font-semibold">No se pudo completar: </strong>
      {texto}
    </p>
  );
};

export const Cargando = ({ que }: { que: string }) => (
  <p role="status" className="py-8 text-sm text-tinta-suave">
    Cargando {que}…
  </p>
);

export const Vacio = ({ titulo, children }: { titulo: string; children?: ReactNode }) => (
  <div className="rounded-md border border-dashed border-linea bg-hoja px-6 py-10 text-center">
    <p className="font-semibold">{titulo}</p>
    {children === undefined ? null : (
      <div className="mt-2 text-sm text-tinta-suave">{children}</div>
    )}
  </div>
);

/** Diálogo modal nativo (<dialog>): foco atrapado y Escape para cerrar, sin dependencias. */
export const Dialogo = ({
  abierto,
  titulo,
  alCerrar,
  children,
}: {
  abierto: boolean;
  titulo: string;
  alCerrar: () => void;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      onClose={alCerrar}
      aria-labelledby="titulo-dialogo"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-linea bg-hoja p-0 text-tinta shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-linea px-5 py-3">
        <h2 id="titulo-dialogo" className="text-lg font-semibold">
          {titulo}
        </h2>
        <button
          type="button"
          onClick={alCerrar}
          className="min-h-11 min-w-11 rounded-md text-tinta-suave hover:text-tinta"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>
      <div className="px-5 py-4">{abierto ? children : null}</div>
    </dialog>
  );
};

export const Encabezado = ({ titulo, children }: { titulo: string; children?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
    {children === undefined ? null : <div className="flex flex-wrap gap-2">{children}</div>}
  </div>
);

export const Tabla = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <div className="overflow-x-auto rounded-md border border-linea bg-hoja">
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{titulo}</caption>
      {children}
    </table>
  </div>
);

export const th = 'border-b border-linea px-3 py-2 text-left font-semibold text-tinta-suave';
export const td = 'border-b border-linea px-3 py-2 align-top';
