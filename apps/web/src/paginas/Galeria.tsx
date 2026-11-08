import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type Brigada,
  type Estacion,
  type EstacionGaleria,
  type FotoGaleria,
  type Galeria as G,
} from '../api.ts';
import { Mapa, type MarcadorMapa } from '../componentes/MapaDiferido.tsx';
import {
  AvisoError,
  Boton,
  Campo,
  Cargando,
  claseEntrada,
  Encabezado,
  fechaHora,
  Vacio,
} from '../componentes/Ui.tsx';
import { textoAlternativo, TIPO_FOTO, VisorFoto } from '../componentes/VisorFoto.tsx';
import { useProyectoId } from './Proyectos.tsx';

/** Hoy en Lima (AAAA-MM-DD), para proponer la fecha del reporte diario. */
const hoyLima = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

/**
 * Miniatura (400 px, generada por el worker) con la URL firmada que trae la página. Tamaño fijo
 * (4:3) para que la grilla no se mueva al cargar; la vista grande solo se pide al abrir el visor.
 */
const Miniatura = ({ foto, alAbrir }: { foto: FotoGaleria; alAbrir: () => void }) => {
  const [fallo, setFallo] = useState(false);
  return (
    <button
      type="button"
      onClick={alAbrir}
      aria-label={`Ver ampliada: ${textoAlternativo(foto)}`}
      className="block aspect-[4/3] w-full bg-liquen-claro"
    >
      {foto.miniatura_url === null || fallo ? (
        <span className="flex h-full items-center justify-center px-2 text-xs text-tinta-suave">
          Vista previa no disponible: ábrala para verla
        </span>
      ) : (
        <img
          src={foto.miniatura_url}
          alt=""
          width={400}
          height={300}
          loading="lazy"
          decoding="async"
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          onError={() => setFallo(true)}
          className="size-full select-none object-cover"
        />
      )}
    </button>
  );
};

const Tarjeta = ({
  foto,
  puedeSeleccionar,
  fechaReporte,
  alCambiar,
  alAbrir,
}: {
  foto: FotoGaleria;
  puedeSeleccionar: boolean;
  fechaReporte: string;
  alCambiar: () => Promise<unknown>;
  alAbrir: () => void;
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
      <Miniatura foto={foto} alAbrir={alAbrir} />
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
  if (metodo !== '') filtros.set('metodo', metodo);
  if (fecha !== '') filtros.set('fecha', fecha);
  if (seleccion !== 'todas') filtros.set('seleccion', seleccion);
  // El mapa usa los mismos filtros salvo la estación (sirve para elegirla).
  const consultaMapa = filtros.toString();
  if (estacion !== '') filtros.set('estacion', estacion);
  const consulta = filtros.toString();
  const q = useInfiniteQuery({
    queryKey: ['galeria', proyectoId, consulta],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(consulta);
      if (pageParam !== null) p.set('cursor', pageParam);
      const t = p.toString();
      return api.get<G>(`/proyectos/${proyectoId}/galeria${t === '' ? '' : `?${t}`}`);
    },
    getNextPageParam: (ultima) => ultima.siguiente,
    // Las miniaturas vienen firmadas por ≤ 15 min: se vuelven a pedir antes de que venzan.
    staleTime: 5 * 60_000,
  });
  const fotos = useMemo(() => q.data?.pages.flatMap((p) => p.fotos) ?? [], [q.data]);
  const puedeSeleccionar = q.data?.pages[0]?.puede_seleccionar === true;
  // Métodos presentes en las fotos cargadas (no hay catálogo de métodos en la web todavía).
  // Se acumulan para que la lista no se vacíe al filtrar por uno.
  const [metodosVistos, setMetodosVistos] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const nuevos = fotos.filter((f) => !metodosVistos.has(f.metodo_id));
    if (nuevos.length === 0) return;
    const m = new Map(metodosVistos);
    for (const f of nuevos) m.set(f.metodo_id, f.metodo_nombre);
    setMetodosVistos(m);
  }, [fotos, metodosVistos]);
  const metodos = useMemo(
    () => [...metodosVistos].sort((a, b) => a[1].localeCompare(b[1])),
    [metodosVistos],
  );

  // Visor: se guarda el id (no el índice) para que siga en la misma foto si la lista se recarga.
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const indiceAbierta = abiertaId === null ? -1 : fotos.findIndex((f) => f.id === abiertaId);

  const recargar = () => qc.invalidateQueries({ queryKey: ['galeria', proyectoId] });

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
        {puedeSeleccionar ? (
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

      <MapaFotos
        proyectoId={proyectoId}
        consulta={consultaMapa}
        elegida={estacion}
        alElegir={setEstacion}
      />

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
            Mostrando <span className="cifras">{fotos.length}</span>{' '}
            {fotos.length === 1 ? 'foto' : 'fotos'}
            {q.hasNextPage ? '; hay más, más antiguas' : ''}.
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {fotos.map((f) => (
              <Tarjeta
                key={f.id}
                foto={f}
                puedeSeleccionar={puedeSeleccionar}
                fechaReporte={fechaReporte}
                alCambiar={recargar}
                alAbrir={() => setAbiertaId(f.id)}
              />
            ))}
          </ul>
          {q.hasNextPage ? (
            <div className="mt-5 flex justify-center">
              <Boton
                variante="secundario"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage ? 'Cargando más fotos…' : 'Cargar más fotos'}
              </Boton>
            </div>
          ) : null}
          <VisorFoto
            fotos={fotos}
            indice={indiceAbierta === -1 ? null : indiceAbierta}
            alCambiar={(i) => setAbiertaId(fotos[i]?.id ?? null)}
            alCerrar={() => setAbiertaId(null)}
          />
        </>
      ) : null}
    </>
  );
};

/**
 * Mini mapa de fotos por estación: un marcador con el número de fotos visibles con los filtros
 * activos (salvo la estación). Usa el agregado del servidor, no carga las fotos; MapLibre se
 * descarga diferido.
 */
const MapaFotos = ({
  proyectoId,
  consulta,
  elegida,
  alElegir,
}: {
  proyectoId: string;
  consulta: string;
  elegida: string;
  alElegir: (estacionId: string) => void;
}) => {
  const q = useQuery({
    queryKey: ['galeria-estaciones', proyectoId, consulta],
    queryFn: () =>
      api.get<{ estaciones: EstacionGaleria[] }>(
        `/proyectos/${proyectoId}/galeria/estaciones${consulta === '' ? '' : `?${consulta}`}`,
      ),
  });
  const estaciones = q.data?.estaciones;
  const marcadores = useMemo(
    () =>
      (estaciones ?? []).map((s): MarcadorMapa => ({
        id: s.estacion_id,
        lat: s.lat,
        lon: s.lon,
        etiqueta: `${s.codigo}: ${String(s.fotos)} ${s.fotos === 1 ? 'foto' : 'fotos'}${s.estacion_id === elegida ? ' (filtro activo)' : '. Elija para filtrar la galería'}`,
        icono: s.fotos > 99 ? '99+' : String(s.fotos),
        forma: 'circulo',
        fondo: '#2e5e4e',
        tinta: '#ffffff',
        elegido: s.estacion_id === elegida,
      })),
    [estaciones, elegida],
  );
  const actual = estaciones?.find((s) => s.estacion_id === elegida);

  return (
    <section aria-labelledby="titulo-mapa-fotos" className="mb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-mapa-fotos" className="text-base font-semibold">
          Fotos por estación
        </h2>
        {elegida === '' ? (
          <p className="text-sm text-tinta-suave">Elija una estación en el mapa para filtrar.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Filtrando por{' '}
              <strong className="font-semibold">{actual?.codigo ?? 'la estación'}</strong>
              {actual === undefined ? '' : ` (${String(actual.fotos)})`}
            </span>
            <Boton variante="secundario" onClick={() => alElegir('')}>
              Quitar filtro de estación
            </Boton>
          </div>
        )}
      </div>
      {q.isPending ? <Cargando que="el mapa de fotos" /> : null}
      <AvisoError error={q.error} />
      {estaciones !== undefined && estaciones.length === 0 ? (
        <p className="text-sm text-tinta-suave">Ninguna estación tiene fotos con estos filtros.</p>
      ) : null}
      {estaciones !== undefined && estaciones.length > 0 ? (
        <Mapa
          puntos={[]}
          marcadores={marcadores}
          alElegir={alElegir}
          alto="19rem"
          etiqueta="Mapa de fotos por estación"
        />
      ) : null}
    </section>
  );
};
