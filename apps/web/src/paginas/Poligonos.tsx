import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useMemo, useRef, useState } from 'react';
import {
  api,
  type AsignacionPoligono,
  type CapaCargada,
  type CapaProyecto,
  type EstacionEnPoligono,
  type PoligonoProyecto,
  type VistaPreviaCapa,
} from '../api.ts';
import {
  Mapa,
  type MarcadorMapa,
  type PoligonoMapa,
  type PuntoMapa,
} from '../componentes/MapaDiferido.tsx';
import { Paginacion, usePaginaCliente } from '../componentes/Paginacion.tsx';
import {
  AvisoError,
  Boton,
  Campo,
  Cargando,
  claseEntrada,
  Encabezado,
  fechaHora,
  Tabla,
  td,
  th,
  Vacio,
} from '../componentes/Ui.tsx';
import { puede, useYo } from '../sesion.ts';
import { useProyectoId } from './Proyectos.tsx';

/**
 * Polígonos del proyecto cargados por KMZ (decisión del usuario, 2026-11-09; cartografía final
 * P-06). Coordinación y JdP suben el KMZ/KML, revisan la vista previa, lo cargan como capa y
 * asignan cada estación a un polígono. Una estación fuera de su polígono se marca con otro color
 * **y** otra forma, y el servidor genera una alerta técnica. La API vuelve a autorizar todo.
 */

// ── Estado de cada estación respecto de su polígono ──

type Situacion = 'dentro' | 'fuera' | 'sin';

const situacion = (e: EstacionEnPoligono): Situacion =>
  e.dentro === null ? 'sin' : e.dentro ? 'dentro' : 'fuera';

const ESTILO: Readonly<
  Record<
    Situacion,
    {
      texto: string;
      icono: string;
      forma: MarcadorMapa['forma'];
      fondo: string;
      tinta: string;
      insignia: string;
    }
  >
> = {
  dentro: {
    texto: 'Dentro',
    icono: '✓',
    forma: 'circulo',
    fondo: '#2e5e4e',
    tinta: '#ffffff',
    insignia: 'border-liquen bg-liquen-claro text-liquen-oscuro',
  },
  fuera: {
    texto: 'Fuera',
    icono: '!',
    forma: 'rombo',
    fondo: '#9b2c1f',
    tinta: '#ffffff',
    insignia: 'border-oxido bg-oxido-claro text-oxido',
  },
  sin: {
    texto: 'Sin polígono',
    icono: '–',
    forma: 'cuadrado',
    fondo: '#ffffff',
    tinta: '#4a5a54',
    insignia: 'border-linea bg-hoja text-tinta-suave',
  },
};

const ORDEN: readonly Situacion[] = ['fuera', 'sin', 'dentro'];

/** Misma forma, ícono y color que el marcador del mapa, para la leyenda y la tabla. */
const Simbolo = ({ s }: { s: Situacion }) => {
  const e = ESTILO[s];
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-5 shrink-0 items-center justify-center text-xs font-bold"
      style={{
        background: e.fondo,
        color: e.tinta,
        border: '2px solid #ffffff',
        boxShadow: '0 0 0 1px rgba(24,35,31,0.55)',
        borderRadius: e.forma === 'circulo' ? '9999px' : '3px',
        transform: e.forma === 'rombo' ? 'rotate(45deg) scale(0.85)' : '',
      }}
    >
      <span style={e.forma === 'rombo' ? { transform: 'rotate(-45deg)' } : undefined}>
        {e.icono}
      </span>
    </span>
  );
};

const Insignia = ({ s }: { s: Situacion }) => (
  <span
    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-semibold ${ESTILO[s].insignia}`}
  >
    <Simbolo s={s} />
    {s === 'fuera' ? 'Fuera ⚠' : s === 'dentro' ? 'Dentro ✓' : ESTILO[s].texto}
  </span>
);

const Leyenda = ({ cuenta }: { cuenta: ReadonlyMap<Situacion, number> }) => (
  <section
    aria-labelledby="leyenda-poligonos"
    className="rounded-md border border-linea bg-hoja p-3"
  >
    <h3 id="leyenda-poligonos" className="mb-2 text-sm font-semibold">
      Estaciones y su polígono
    </h3>
    <ul className="flex flex-col gap-1.5">
      {ORDEN.map((s) => (
        <li key={s} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Simbolo s={s} />
            {s === 'fuera'
              ? 'Fuera de su polígono (rombo)'
              : s === 'dentro'
                ? 'Dentro de su polígono (círculo)'
                : 'Sin polígono asignado (cuadrado)'}
          </span>
          <span className="cifras text-tinta-suave">{cuenta.get(s) ?? 0}</span>
        </li>
      ))}
      <li className="flex items-center gap-2 text-sm">
        <span
          aria-hidden="true"
          className="inline-block h-4 w-5 shrink-0 border-2 border-liquen-oscuro bg-liquen-claro"
        />
        Polígono del proyecto (con su nombre)
      </li>
    </ul>
    <p className="mt-2 text-xs text-tinta-suave">
      Una estación fuera de su polígono genera una alerta técnica que cierran Coordinación o JdP.
    </p>
  </section>
);

const marcadoresDe = (
  estaciones: readonly EstacionEnPoligono[],
  nombrePoligono: ReadonlyMap<string, string>,
  elegidas: ReadonlySet<string>,
): MarcadorMapa[] =>
  estaciones.map((e) => {
    const s = situacion(e);
    const estilo = ESTILO[s];
    const pol = e.poligono_id === null ? undefined : nombrePoligono.get(e.poligono_id);
    return {
      id: e.estacion_id,
      lat: e.lat,
      lon: e.lon,
      etiqueta: `${e.codigo}: ${
        s === 'sin'
          ? 'sin polígono asignado'
          : `${s === 'fuera' ? 'fuera de' : 'dentro de'} su polígono ${pol ?? ''}`.trim()
      }${elegidas.has(e.estacion_id) ? ' (seleccionada)' : ''}`,
      icono: estilo.icono,
      forma: estilo.forma,
      fondo: estilo.fondo,
      tinta: estilo.tinta,
      elegido: elegidas.has(e.estacion_id),
    };
  });

// ── Cargar un KMZ: archivo → vista previa → cargar ──

const sinExtension = (nombre: string) => nombre.replace(/\.km[lz]$/i, '');

const CargarKmz = ({
  proyectoId,
  estaciones,
}: {
  proyectoId: string;
  estaciones: readonly EstacionEnPoligono[];
}) => {
  const qc = useQueryClient();
  const idArchivo = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [nombre, setNombre] = useState('');
  const [asignar, setAsignar] = useState(true);
  const previa = useMutation({
    mutationFn: (f: File) =>
      api.subir<VistaPreviaCapa>(`/proyectos/${proyectoId}/capas/vista-previa`, f, {
        tipo: 'application/octet-stream',
      }),
  });
  const carga = useMutation({
    mutationFn: (f: File) =>
      api.subir<CapaCargada>(
        `/proyectos/${proyectoId}/capas?asignar=${asignar ? 'dentro' : 'no'}`,
        f,
        {
          tipo: 'application/octet-stream',
          cabeceras: nombre.trim() === '' ? {} : { 'x-nombre-capa': nombre.trim() },
        },
      ),
    onSuccess: async () => {
      setArchivo(null);
      setNombre('');
      previa.reset();
      if (entrada.current !== null) entrada.current.value = '';
      // Capas, polígonos, estaciones y alertas cambian a la vez.
      await qc.invalidateQueries();
    },
  });
  const vista = previa.data;
  const poligonosPrevia = useMemo(
    (): PoligonoMapa[] =>
      (vista?.poligonos ?? []).map((p, i) => ({
        id: `previa-${String(i)}`,
        nombre: p.nombre,
        geometria: p.geometria,
      })),
    [vista],
  );
  const puntos = useMemo(
    (): PuntoMapa[] =>
      estaciones.map((e) => ({ id: e.estacion_id, lat: e.lat, lon: e.lon, titulo: e.codigo })),
    [estaciones],
  );
  const conEstaciones = new Set(
    (vista?.poligonos ?? []).flatMap((p) => p.estaciones_dentro.map((e) => e.id)),
  ).size;
  const r = carga.data;

  return (
    <section
      aria-labelledby="titulo-cargar-kmz"
      className="rounded-md border border-linea bg-papel p-4"
    >
      <h2 id="titulo-cargar-kmz" className="text-lg font-semibold">
        Cargar polígonos (KMZ o KML)
      </h2>
      <p className="mt-1 max-w-prose text-sm text-tinta-suave">
        Suba el KMZ entregado por el proyecto. Cada polígono del archivo queda en una capa nueva;
        las capas anteriores no se borran. Primero verá una vista previa: subir no guarda nada.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (archivo !== null) previa.mutate(archivo);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={idArchivo} className="text-sm font-semibold">
            Archivo .kmz o .kml (hasta 20 MB)
          </label>
          <input
            ref={entrada}
            id={idArchivo}
            type="file"
            accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
            onChange={(ev) => {
              const f = ev.target.files?.[0] ?? null;
              setArchivo(f);
              setNombre(f === null ? '' : sinExtension(f.name));
              previa.reset();
              carga.reset();
            }}
            className="min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-linea file:bg-hoja file:px-3"
          />
        </div>
        <Boton type="submit" disabled={archivo === null} ocupado={previa.isPending}>
          Ver vista previa
        </Boton>
      </form>
      <AvisoError error={previa.error} />

      {vista === undefined || archivo === null ? null : (
        <div className="mt-4 flex flex-col gap-4">
          <p role="status" className="text-sm">
            <strong className="font-semibold">Vista previa de «{archivo.name}»:</strong>{' '}
            {vista.poligonos.length === 1
              ? '1 polígono'
              : `${String(vista.poligonos.length)} polígonos`}
            , {conEstaciones} de {estaciones.length} estaciones caen dentro de alguno
            {vista.ignorados.length > 0
              ? ` y ${String(vista.ignorados.length)} elementos se ignoran`
              : ''}
            .
          </p>
          {vista.poligonos.length === 0 ? (
            <Vacio titulo="El archivo no trae polígonos">
              Solo se cargan Placemarks con polígono. Revise el archivo y vuelva a subirlo.
            </Vacio>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
              <Mapa
                puntos={puntos}
                poligonos={poligonosPrevia}
                alto="22rem"
                etiqueta="Vista previa de los polígonos del archivo"
              />
              <div className="max-h-[22rem] overflow-y-auto rounded-md border border-linea bg-hoja p-3">
                <h3 className="mb-2 text-sm font-semibold">Polígonos del archivo</h3>
                <ul className="flex flex-col gap-2 text-sm">
                  {vista.poligonos.map((p, i) => (
                    <li key={i}>
                      <p className="font-semibold">{p.nombre}</p>
                      <p className="text-tinta-suave">
                        {p.estaciones_dentro.length === 0
                          ? 'Ninguna estación dentro'
                          : `${String(p.estaciones_dentro.length)} ${p.estaciones_dentro.length === 1 ? 'estación' : 'estaciones'} dentro: ${p.estaciones_dentro.map((e) => e.codigo).join(', ')}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {vista.ignorados.length > 0 ? (
            <details className="rounded-md border border-ocre bg-ocre-claro px-3 py-2 text-sm">
              <summary className="min-h-11 cursor-pointer content-center font-semibold">
                <span aria-hidden="true">? </span>
                {vista.ignorados.length} elementos ignorados (sin polígono o con geometría inválida)
              </summary>
              <ul className="mt-2 list-disc pl-5">
                {vista.ignorados.map((g, i) => (
                  <li key={i}>
                    {g.nombre}: {g.motivo}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {vista.poligonos.length > 0 ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(ev) => {
                ev.preventDefault();
                carga.mutate(archivo);
              }}
            >
              <div className="max-w-md">
                <Campo
                  etiqueta="Nombre de la capa"
                  ayuda="Por defecto, el nombre del archivo sin la extensión."
                >
                  {(id) => (
                    <input
                      id={id}
                      value={nombre}
                      maxLength={120}
                      onChange={(e) => setNombre(e.target.value)}
                      className={claseEntrada}
                    />
                  )}
                </Campo>
              </div>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={asignar}
                  onChange={(e) => setAsignar(e.target.checked)}
                  className="size-5 accent-liquen"
                />
                Asignar automáticamente las estaciones que caen dentro
              </label>
              <p className="-mt-2 text-xs text-tinta-suave">
                Solo se asignan las estaciones que aún no tienen polígono: nunca se cambia una
                asignación hecha antes.
              </p>
              <AvisoError error={carga.error} />
              <div className="flex flex-wrap gap-2">
                <Boton type="submit" ocupado={carga.isPending}>
                  Cargar
                </Boton>
                <Boton
                  variante="secundario"
                  onClick={() => {
                    previa.reset();
                    setArchivo(null);
                    if (entrada.current !== null) entrada.current.value = '';
                  }}
                >
                  Descartar
                </Boton>
              </div>
            </form>
          ) : null}
        </div>
      )}
      {r === undefined ? null : (
        <p role="status" className="mt-3 text-sm text-liquen-oscuro">
          <span aria-hidden="true">✓ </span>
          Capa cargada con {r.poligonos} {r.poligonos === 1 ? 'polígono' : 'polígonos'}
          {r.ignorados.length > 0
            ? ` (${String(r.ignorados.length)} elementos ignorados)`
            : ''}.{' '}
          {asignar
            ? `${String(r.estaciones_asignadas)} ${r.estaciones_asignadas === 1 ? 'estación asignada' : 'estaciones asignadas'} automáticamente.`
            : 'No se asignaron estaciones: hágalo en la tabla de abajo.'}
        </p>
      )}
    </section>
  );
};

// ── Asignar estaciones a un polígono ──

const QUITAR = '__quitar';
type Filtro = 'todas' | Situacion;

const ETIQUETA_FILTRO: Readonly<Record<Filtro, string>> = {
  todas: 'Todas',
  fuera: 'Fuera de su polígono',
  sin: 'Sin polígono',
  dentro: 'Dentro de su polígono',
};

const Asignacion = ({
  proyectoId,
  estaciones,
  poligonos,
  gestionar,
  elegidas,
  setElegidas,
}: {
  proyectoId: string;
  estaciones: readonly EstacionEnPoligono[];
  poligonos: readonly PoligonoProyecto[];
  gestionar: boolean;
  elegidas: ReadonlySet<string>;
  setElegidas: (s: ReadonlySet<string>) => void;
}) => {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [destino, setDestino] = useState('');
  const lista = filtro === 'todas' ? estaciones : estaciones.filter((e) => situacion(e) === filtro);
  const pag = usePaginaCliente(lista, filtro);
  const nombre = new Map(poligonos.map((p) => [p.id, p]));
  const porCapa = new Map<string, PoligonoProyecto[]>();
  for (const p of poligonos) porCapa.set(p.capa_nombre, [...(porCapa.get(p.capa_nombre) ?? []), p]);
  const asignar = useMutation({
    mutationFn: () =>
      api.post<AsignacionPoligono>(`/proyectos/${proyectoId}/estaciones/poligono`, {
        estacion_ids: [...elegidas],
        poligono_id: destino === QUITAR ? null : destino,
      }),
    onSuccess: async () => {
      setElegidas(new Set());
      await qc.invalidateQueries();
    },
  });
  const todasVisibles =
    pag.visibles.length > 0 && pag.visibles.every((e) => elegidas.has(e.estacion_id));
  const alternar = (id: string) => {
    const s = new Set(elegidas);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setElegidas(s);
  };
  const r = asignar.data;

  return (
    <section aria-labelledby="titulo-asignacion" className="flex flex-col gap-3">
      <h2 id="titulo-asignacion" className="text-lg font-semibold">
        Estaciones y su polígono
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-60">
          <Campo etiqueta="Mostrar">
            {(id) => (
              <select
                id={id}
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as Filtro)}
                className={claseEntrada}
              >
                {(['todas', ...ORDEN] as const).map((f) => (
                  <option key={f} value={f}>
                    {ETIQUETA_FILTRO[f]}
                  </option>
                ))}
              </select>
            )}
          </Campo>
        </div>
        {gestionar && lista.length > 0 ? (
          <Boton
            variante="secundario"
            onClick={() => setElegidas(new Set([...elegidas, ...lista.map((e) => e.estacion_id)]))}
          >
            Seleccionar las {lista.length} {filtro === 'todas' ? 'estaciones' : 'del filtro'}
          </Boton>
        ) : null}
      </div>

      {gestionar ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-md border border-linea bg-hoja p-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            asignar.mutate();
          }}
        >
          <p className="min-h-11 content-center text-sm font-semibold" aria-live="polite">
            {elegidas.size === 0
              ? 'Ninguna estación seleccionada'
              : `${String(elegidas.size)} ${elegidas.size === 1 ? 'estación seleccionada' : 'estaciones seleccionadas'}`}
          </p>
          <div className="w-72">
            <Campo etiqueta="Polígono">
              {(id) => (
                <select
                  id={id}
                  value={destino}
                  required
                  onChange={(e) => setDestino(e.target.value)}
                  className={claseEntrada}
                >
                  <option value="" disabled>
                    Elija un polígono…
                  </option>
                  {[...porCapa.entries()].map(([capa, ps]) => (
                    <optgroup key={capa} label={`Capa ${capa}`}>
                      {ps.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <option value={QUITAR}>Quitar polígono</option>
                </select>
              )}
            </Campo>
          </div>
          <Boton
            type="submit"
            disabled={elegidas.size === 0 || destino === ''}
            ocupado={asignar.isPending}
          >
            {destino === QUITAR ? 'Quitar polígono' : 'Asignar'}
          </Boton>
          {elegidas.size > 0 ? (
            <Boton variante="secundario" onClick={() => setElegidas(new Set())}>
              Limpiar selección
            </Boton>
          ) : null}
        </form>
      ) : null}
      <AvisoError error={asignar.error} />
      {r === undefined ? null : (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${r.fuera.length > 0 ? 'border-oxido bg-oxido-claro' : 'border-liquen bg-liquen-claro'}`}
        >
          <p>
            <span aria-hidden="true">✓ </span>
            {r.asignadas === 1
              ? '1 estación actualizada'
              : `${String(r.asignadas)} estaciones actualizadas`}
            .
          </p>
          {r.fuera.length > 0 ? (
            <p className="mt-1 text-oxido">
              <span aria-hidden="true">⚠ </span>
              {r.fuera.length === 1 ? 'Quedó fuera' : `Quedaron fuera ${String(r.fuera.length)}`} de
              su polígono: {r.fuera.join(', ')}.
            </p>
          ) : null}
          {r.alertas_nuevas > 0 ? (
            <p className="mt-1">
              Se{' '}
              {r.alertas_nuevas === 1
                ? 'generó 1 alerta técnica'
                : `generaron ${String(r.alertas_nuevas)} alertas técnicas`}
              .{' '}
              <Link
                to="/p/$proyectoId/alertas"
                params={{ proyectoId }}
                className="font-semibold underline underline-offset-2"
              >
                Ver alertas
              </Link>
            </p>
          ) : null}
        </div>
      )}

      {lista.length === 0 ? (
        <Vacio titulo="No hay estaciones con ese estado" />
      ) : (
        <>
          <Tabla titulo="Estaciones y su polígono">
            <thead>
              <tr>
                {gestionar ? (
                  <th className={`${th} w-12`}>
                    <input
                      type="checkbox"
                      checked={todasVisibles}
                      onChange={() => {
                        const s = new Set(elegidas);
                        for (const e of pag.visibles) {
                          if (todasVisibles) s.delete(e.estacion_id);
                          else s.add(e.estacion_id);
                        }
                        setElegidas(s);
                      }}
                      aria-label="Seleccionar las estaciones de esta página"
                      className="size-5 accent-liquen"
                    />
                  </th>
                ) : null}
                <th className={th}>Código</th>
                <th className={th}>Polígono</th>
                <th className={th}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {pag.visibles.map((e) => {
                const p = e.poligono_id === null ? undefined : nombre.get(e.poligono_id);
                return (
                  <tr key={e.estacion_id}>
                    {gestionar ? (
                      <td className={td}>
                        <input
                          type="checkbox"
                          checked={elegidas.has(e.estacion_id)}
                          onChange={() => alternar(e.estacion_id)}
                          aria-label={`Seleccionar la estación ${e.codigo}`}
                          className="size-5 accent-liquen"
                        />
                      </td>
                    ) : null}
                    <td className={`${td} font-semibold`}>{e.codigo}</td>
                    <td className={td}>
                      {p === undefined ? (
                        <span className="text-tinta-suave">—</span>
                      ) : (
                        <>
                          {p.nombre}
                          <br />
                          <span className="text-xs text-tinta-suave">Capa {p.capa_nombre}</span>
                        </>
                      )}
                    </td>
                    <td className={td}>
                      <Insignia s={situacion(e)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Tabla>
          <Paginacion etiqueta="Páginas de estaciones y polígonos" {...pag.props} />
        </>
      )}
    </section>
  );
};

// ── Página ──

export const Poligonos = () => {
  const proyectoId = useProyectoId();
  const yo = useYo();
  const gestionar = puede(yo.data).gestionar;
  const capas = useQuery({
    queryKey: ['capas', proyectoId],
    queryFn: () => api.get<CapaProyecto[]>(`/proyectos/${proyectoId}/capas`),
  });
  const poligonos = useQuery({
    queryKey: ['poligonos', proyectoId],
    queryFn: () => api.get<PoligonoProyecto[]>(`/proyectos/${proyectoId}/poligonos`),
  });
  const estaciones = useQuery({
    queryKey: ['estaciones-poligono', proyectoId],
    queryFn: () => api.get<EstacionEnPoligono[]>(`/proyectos/${proyectoId}/estaciones/poligonos`),
  });
  const [elegidas, setElegidas] = useState<ReadonlySet<string>>(new Set());

  const listaPol = useMemo(() => poligonos.data ?? [], [poligonos.data]);
  const listaEst = useMemo(() => estaciones.data ?? [], [estaciones.data]);
  const nombrePoligono = useMemo(() => new Map(listaPol.map((p) => [p.id, p.nombre])), [listaPol]);
  const poligonosMapa = useMemo(
    (): PoligonoMapa[] =>
      listaPol.map((p) => ({ id: p.id, nombre: p.nombre, geometria: p.geometria })),
    [listaPol],
  );
  const marcadores = useMemo(
    () => marcadoresDe(listaEst, nombrePoligono, elegidas),
    [listaEst, nombrePoligono, elegidas],
  );
  const cuenta = new Map<Situacion, number>();
  for (const e of listaEst) cuenta.set(situacion(e), (cuenta.get(situacion(e)) ?? 0) + 1);
  const cargando = capas.isPending || poligonos.isPending || estaciones.isPending;
  const sinCapas = capas.data !== undefined && capas.data.length === 0;

  return (
    <>
      <p className="mb-1 text-sm">
        <Link
          to="/p/$proyectoId"
          params={{ proyectoId }}
          className="text-liquen underline-offset-4 hover:underline"
        >
          <span aria-hidden="true">← </span>Estaciones
        </Link>
      </p>
      <Encabezado titulo="Polígonos del proyecto (KMZ)" />
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Cada estación puede asignarse a un polígono del KMZ del proyecto. Si sus coordenadas (A01)
        quedan fuera, se marca en la web y en el celular y se genera una alerta técnica. Una unidad
        registrada fuera del polígono de su estación solo es una advertencia: no bloquea.
      </p>

      {cargando ? <Cargando que="los polígonos del proyecto" /> : null}
      <AvisoError error={capas.error ?? poligonos.error ?? estaciones.error} />

      <div className="flex flex-col gap-6">
        {gestionar && estaciones.data !== undefined ? (
          <CargarKmz proyectoId={proyectoId} estaciones={listaEst} />
        ) : null}

        {sinCapas ? (
          <Vacio titulo="Aún no hay polígonos cargados">
            {gestionar
              ? 'Cargue el KMZ con los polígonos entregado por el proyecto (la cartografía final está pendiente, P-06). Luego asigne cada estación a su polígono.'
              : 'Coordinación o el Jefe de Proyecto cargan el KMZ con los polígonos entregado por el proyecto (la cartografía final está pendiente, P-06).'}
          </Vacio>
        ) : null}

        {capas.data !== undefined && capas.data.length > 0 ? (
          <Tabla titulo="Capas cargadas">
            <thead>
              <tr>
                <th className={th}>Capa</th>
                <th className={th}>Archivo</th>
                <th className={th}>Polígonos</th>
                <th className={th}>Cargada</th>
              </tr>
            </thead>
            <tbody>
              {capas.data.map((c) => (
                <tr key={c.id}>
                  <td className={`${td} font-semibold`}>{c.nombre}</td>
                  <td className={`${td} break-all`}>{c.archivo_nombre}</td>
                  <td className={`${td} cifras`}>{c.poligonos}</td>
                  <td className={td}>
                    {fechaHora(c.creado_en)}
                    {c.cargado_por_nombre === null ? null : (
                      <>
                        <br />
                        <span className="text-xs text-tinta-suave">por {c.cargado_por_nombre}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        ) : null}

        {estaciones.data !== undefined && poligonos.data !== undefined && !sinCapas ? (
          <>
            <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
              <Mapa
                puntos={[]}
                poligonos={poligonosMapa}
                marcadores={marcadores}
                {...(gestionar
                  ? {
                      alElegir: (id: string) => {
                        const s = new Set(elegidas);
                        if (s.has(id)) s.delete(id);
                        else s.add(id);
                        setElegidas(s);
                      },
                    }
                  : {})}
                alto="28rem"
                etiqueta="Mapa de los polígonos del proyecto y sus estaciones"
              />
              <div className="flex flex-col gap-4">
                <Leyenda cuenta={cuenta} />
                <section
                  aria-labelledby="lista-poligonos"
                  className="max-h-80 overflow-y-auto rounded-md border border-linea bg-hoja p-3"
                >
                  <h3 id="lista-poligonos" className="mb-2 text-sm font-semibold">
                    Polígonos ({listaPol.length})
                  </h3>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {listaPol.map((p) => (
                      <li key={p.id}>
                        <span className="font-semibold">{p.nombre}</span>{' '}
                        <span className="text-tinta-suave">
                          · {p.estaciones} {p.estaciones === 1 ? 'estación' : 'estaciones'}
                          {p.fuera > 0 ? (
                            <span className="font-semibold text-oxido">
                              , <span aria-hidden="true">⚠ </span>
                              {p.fuera} fuera
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                {gestionar ? (
                  <p className="text-xs text-tinta-suave">
                    Elija una estación en el mapa para agregarla o quitarla de la selección.
                  </p>
                ) : null}
              </div>
            </div>
            {listaEst.length === 0 ? (
              <Vacio titulo="Aún no hay estaciones">
                Las estaciones llegan con la carga de A01 o se agregan en Estaciones.
              </Vacio>
            ) : (
              <Asignacion
                proyectoId={proyectoId}
                estaciones={listaEst}
                poligonos={listaPol}
                gestionar={gestionar}
                elegidas={elegidas}
                setElegidas={setElegidas}
              />
            )}
          </>
        ) : null}
      </div>
    </>
  );
};
