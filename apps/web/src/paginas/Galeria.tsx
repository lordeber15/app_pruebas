import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, type Brigada, type Estacion, type FotoGaleria, type Galeria as G } from '../api.ts';
import {
  AvisoError,
  Campo,
  Cargando,
  claseEntrada,
  Encabezado,
  fechaHora,
  Vacio,
} from '../componentes/Ui.tsx';
import { useProyectoId } from './Proyectos.tsx';

const TIPO_FOTO: Readonly<Record<string, string>> = {
  contexto: 'Contexto',
  metodologica: 'Metodológica',
  primer_plano: 'Primer plano',
  cientifica: 'Científica',
};

/** Hoy en Lima (AAAA-MM-DD), para proponer la fecha del reporte diario. */
const hoyLima = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

/** Miniatura por URL firmada (≤ 15 min): la API vuelve a autorizar cada foto. */
const Miniatura = ({ foto }: { foto: FotoGaleria }) => {
  const q = useQuery({
    queryKey: ['url-archivo', foto.id, 'miniatura'],
    queryFn: () => api.get<{ url: string }>(`/archivos/${foto.id}/url?variante=miniatura`),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const alt = `${TIPO_FOTO[foto.tipo_foto ?? ''] ?? 'Foto'} de ${foto.estacion_codigo}, ${foto.metodo_nombre}${foto.unidad_codigo === null ? '' : `, unidad ${foto.unidad_codigo}`}`;
  if (q.data === undefined) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-liquen-claro text-xs text-tinta-suave">
        {q.isError ? 'Vista previa no disponible' : 'Cargando…'}
      </div>
    );
  }
  return (
    <a href={q.data.url} target="_blank" rel="noreferrer" className="block">
      <img
        src={q.data.url}
        alt={alt}
        loading="lazy"
        className="aspect-[4/3] w-full bg-liquen-claro object-cover"
      />
    </a>
  );
};

const Tarjeta = ({
  foto,
  puedeSeleccionar,
  fechaReporte,
  alCambiar,
}: {
  foto: FotoGaleria;
  puedeSeleccionar: boolean;
  fechaReporte: string;
  alCambiar: () => Promise<unknown>;
}) => {
  const candidata = useMutation({
    mutationFn: (valor: boolean) =>
      api.post(`/archivos/${foto.id}/candidata`, { candidata: valor }),
    onSuccess: alCambiar,
  });
  const seleccion = useMutation({
    mutationFn: (valor: boolean) =>
      api.post(`/archivos/${foto.id}/seleccion-reporte`, {
        seleccionada: valor,
        fecha: valor ? fechaReporte : null,
      }),
    onSuccess: alCambiar,
  });
  return (
    <li
      className={`flex flex-col overflow-hidden rounded-md border bg-hoja ${foto.seleccionada_reporte ? 'border-liquen ring-2 ring-liquen' : 'border-linea'}`}
    >
      <Miniatura foto={foto} />
      <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
        <p>
          <span className="font-semibold">{foto.estacion_codigo}</span> · {foto.metodo_nombre}
          {foto.unidad_codigo === null ? '' : ` · ${foto.unidad_codigo}`}
        </p>
        <p className="text-xs text-tinta-suave">
          {TIPO_FOTO[foto.tipo_foto ?? ''] ?? 'Foto'}
          {foto.orientacion === null ? '' : ` (${foto.orientacion})`} · {foto.usuario_nombre} ·{' '}
          <span className="cifras">{fechaHora(foto.capturado_en)}</span>
        </p>
        {foto.seleccionada_reporte ? (
          <p className="text-xs font-semibold text-liquen-oscuro">
            <span aria-hidden="true">★ </span>En el reporte del {foto.seleccion_fecha}
          </p>
        ) : null}
        <div className="mt-auto flex flex-col gap-1">
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={foto.candidata_reporte}
              disabled={!foto.puede_marcar || candidata.isPending}
              onChange={(e) => candidata.mutate(e.target.checked)}
              className="size-5 accent-liquen"
            />
            Candidata para el reporte diario
          </label>
          {puedeSeleccionar ? (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={foto.seleccionada_reporte}
                disabled={seleccion.isPending}
                onChange={(e) => seleccion.mutate(e.target.checked)}
                className="size-5 accent-liquen"
              />
              {foto.seleccionada_reporte
                ? 'Seleccionada para el reporte'
                : `Seleccionar para el reporte del ${fechaReporte}`}
            </label>
          ) : null}
          <AvisoError error={candidata.error ?? seleccion.error} />
        </div>
      </div>
    </li>
  );
};

type Seleccion = 'todas' | 'candidatas' | 'seleccionadas';
const SELECCIONES: readonly { valor: Seleccion; texto: string }[] = [
  { valor: 'todas', texto: 'Todas las fotos' },
  { valor: 'candidatas', texto: 'Solo candidatas' },
  { valor: 'seleccionadas', texto: 'Solo seleccionadas' },
];

/** Galería de evidencias verificadas y selección manual para el reporte diario (D02 §8, E-10). */
export const Galeria = () => {
  const proyectoId = useProyectoId();
  const qc = useQueryClient();
  const [brigada, setBrigada] = useState('');
  const [estacion, setEstacion] = useState('');
  const [metodo, setMetodo] = useState('');
  const [fecha, setFecha] = useState('');
  const [seleccion, setSeleccion] = useState<Seleccion>('todas');
  const [fechaReporte, setFechaReporte] = useState(hoyLima);

  const brigadas = useQuery({
    queryKey: ['brigadas', proyectoId],
    queryFn: () => api.get<{ brigadas: Brigada[] }>(`/proyectos/${proyectoId}/brigadas`),
  });
  const estaciones = useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
  });
  const filtros = new URLSearchParams();
  if (brigada !== '') filtros.set('brigada', brigada);
  if (estacion !== '') filtros.set('estacion', estacion);
  if (metodo !== '') filtros.set('metodo', metodo);
  if (fecha !== '') filtros.set('fecha', fecha);
  if (seleccion !== 'todas') filtros.set('seleccion', seleccion);
  const consulta = filtros.toString();
  const q = useQuery({
    queryKey: ['galeria', proyectoId, consulta],
    queryFn: () =>
      api.get<G>(`/proyectos/${proyectoId}/galeria${consulta === '' ? '' : `?${consulta}`}`),
  });
  // Métodos presentes en las fotos cargadas (no hay catálogo de métodos en la web todavía).
  // Se acumulan para que la lista no se vacíe al filtrar por uno.
  const [metodosVistos, setMetodosVistos] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const nuevos = (q.data?.fotos ?? []).filter((f) => !metodosVistos.has(f.metodo_id));
    if (nuevos.length === 0) return;
    const m = new Map(metodosVistos);
    for (const f of nuevos) m.set(f.metodo_id, f.metodo_nombre);
    setMetodosVistos(m);
  }, [q.data, metodosVistos]);
  const metodos = useMemo(
    () => [...metodosVistos].sort((a, b) => a[1].localeCompare(b[1])),
    [metodosVistos],
  );

  const recargar = () => qc.invalidateQueries({ queryKey: ['galeria', proyectoId] });
  const fotos = q.data?.fotos ?? [];

  return (
    <>
      <Encabezado titulo="Galería" />
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Fotos ya verificadas en el servidor. Quien registra la foto, su Supervisor de campo,
        Coordinación o el Jefe de Proyecto pueden marcarla como candidata; Coordinación o el Jefe de
        Proyecto eligen manualmente las fotos finales de cada reporte diario.
      </p>
      <p
        role="note"
        className="mb-4 max-w-prose rounded-md border border-ocre bg-ocre-claro px-3 py-2 text-sm"
      >
        <strong className="font-semibold">Reporte diario: </strong>la salida en Excel y PDF se
        generará con la plantilla original que entregue Walsh (pendiente P-13). Por ahora aquí solo
        se seleccionan sus fotos.
      </p>

      <form
        className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        aria-label="Filtros de la galería"
        onSubmit={(e) => e.preventDefault()}
      >
        <Campo etiqueta="Brigada">
          {(id) => (
            <select
              id={id}
              value={brigada}
              onChange={(e) => setBrigada(e.target.value)}
              className={claseEntrada}
            >
              <option value="">Todas</option>
              {brigadas.data?.brigadas.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.codigo ?? b.nombre}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Estación">
          {(id) => (
            <select
              id={id}
              value={estacion}
              onChange={(e) => setEstacion(e.target.value)}
              className={claseEntrada}
            >
              <option value="">Todas</option>
              {estaciones.data?.estaciones.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Método">
          {(id) => (
            <select
              id={id}
              value={metodo}
              onChange={(e) => setMetodo(e.target.value)}
              className={claseEntrada}
            >
              <option value="">Todos</option>
              {metodos.map(([mid, nombre]) => (
                <option key={mid} value={mid}>
                  {nombre}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Día de captura">
          {(id) => (
            <input
              id={id}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className={claseEntrada}
            />
          )}
        </Campo>
        <Campo etiqueta="Mostrar">
          {(id) => (
            <select
              id={id}
              value={seleccion}
              onChange={(e) => {
                const v = SELECCIONES.find((s) => s.valor === e.target.value);
                if (v !== undefined) setSeleccion(v.valor);
              }}
              className={claseEntrada}
            >
              {SELECCIONES.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.texto}
                </option>
              ))}
            </select>
          )}
        </Campo>
        {q.data?.puede_seleccionar === true ? (
          <Campo etiqueta="Fecha del reporte diario">
            {(id) => (
              <input
                id={id}
                type="date"
                required
                value={fechaReporte}
                onChange={(e) =>
                  setFechaReporte(e.target.value === '' ? hoyLima() : e.target.value)
                }
                className={claseEntrada}
              />
            )}
          </Campo>
        ) : null}
      </form>

      {q.isPending ? <Cargando que="las fotos" /> : null}
      <AvisoError error={q.error} />
      {q.data !== undefined && fotos.length === 0 ? (
        <Vacio titulo="No hay fotos verificadas con estos filtros">
          Las fotos aparecen cuando el celular las sube y el servidor verifica su integridad.
        </Vacio>
      ) : null}
      {fotos.length > 0 ? (
        <>
          <p className="mb-3 text-sm text-tinta-suave" role="status">
            {fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'}
            {q.data?.truncado === true
              ? ' (se muestran las más recientes; use los filtros para acotar)'
              : ''}
            .
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {fotos.map((f) => (
              <Tarjeta
                key={f.id}
                foto={f}
                puedeSeleccionar={q.data?.puede_seleccionar === true}
                fechaReporte={fechaReporte}
                alCambiar={recargar}
              />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
};
