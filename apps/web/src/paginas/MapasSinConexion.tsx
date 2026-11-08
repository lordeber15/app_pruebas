import {
  bboxSchema,
  crearPaqueteMapaSchema,
  ladosBboxKm,
  LADO_MAXIMO_AREA_KM,
  MARGEN_AREA_BRIGADA_KM,
  TAMANO_MAXIMO_PAQUETE_MAPA,
  validarAreaUsuario,
  ZOOM_MAXIMO_MAPA,
  type Bbox,
  type CrearPaqueteMapa,
  type EstadoPaqueteMapa,
  type PaqueteMapa,
} from '@campo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ErrorApi, type Brigada, type Estacion } from '../api.ts';
import { Mapa, type CapaMapa, type PuntoMapa } from '../componentes/MapaDiferido.tsx';
import { poligonoDeBbox } from '../componentes/rectangulo.ts';
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
 * Mapas sin conexión del proyecto (RF-M05, RF-W10). Coordinación y JdP ven las áreas que el
 * servidor recorta del mapa base, generan las de cada brigada y marcan áreas propias. Los celulares
 * las descargan con WiFi. La API vuelve a autorizar cada acción.
 */

/** Estado del paquete: ícono + forma + texto; el color nunca es el único indicador. */
const ESTADO: Readonly<
  Record<EstadoPaqueteMapa, { texto: string; icono: string; clase: string; redondo: boolean }>
> = {
  pendiente: {
    texto: 'Pendiente',
    icono: '○',
    clase: 'border-linea bg-hoja text-tinta-suave',
    redondo: true,
  },
  generando: {
    texto: 'Generando',
    icono: '◐',
    clase: 'border-ocre bg-ocre-claro text-tinta',
    redondo: true,
  },
  listo: {
    texto: 'Listo',
    icono: '✓',
    clase: 'border-liquen bg-liquen-claro text-liquen-oscuro',
    redondo: true,
  },
  error: {
    texto: 'Error',
    icono: '!',
    clase: 'border-oxido bg-oxido-claro text-oxido',
    redondo: false,
  },
};

const EstadoPaquete = ({ p }: { p: PaqueteMapa }) => {
  const e = ESTADO[p.estado];
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex w-fit items-center gap-1.5 border px-2 py-0.5 text-xs font-semibold ${e.redondo ? 'rounded-full' : 'rounded-sm'} ${e.clase}`}
      >
        <span aria-hidden="true">{e.icono}</span>
        {e.texto}
      </span>
      {p.estado === 'error' && p.error !== null ? (
        <span className="max-w-xs text-xs text-oxido">{p.error}</span>
      ) : null}
    </div>
  );
};

const numero = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });
const MB = 1024 * 1024;
const enMb = (bytes: number): string => `${numero.format(bytes / MB)} MB`;

const ladosTexto = (bbox: Bbox): string => {
  const { ancho, alto } = ladosBboxKm(bbox);
  return `${numero.format(ancho)} × ${numero.format(alto)} km`;
};

const nombreBrigada = (b: Brigada): string =>
  b.codigo === null || b.codigo === b.nombre ? b.nombre : `${b.codigo} · ${b.nombre}`;

const enProceso = (paquetes: readonly PaqueteMapa[] | undefined): boolean =>
  (paquetes ?? []).some((p) => p.estado === 'pendiente' || p.estado === 'generando');

/**
 * Valida el área antes de enviarla con el mismo esquema y la misma comprobación que la API
 * (core). Devuelve el cuerpo listo o el mensaje para la persona.
 */
const validarNuevaArea = (
  nombre: string,
  bbox: Bbox | null,
  brigadaId: string,
): { ok: true; cuerpo: CrearPaqueteMapa } | { ok: false; mensaje: string } => {
  if (bbox === null) return { ok: false, mensaje: 'Marque el área en el mapa.' };
  if (!bboxSchema.safeParse(bbox).success)
    return {
      ok: false,
      mensaje: 'El área no es válida: acerque el mapa y vuelva a marcarla.',
    };
  const tam = validarAreaUsuario(bbox);
  if (!tam.ok) return { ok: false, mensaje: tam.mensaje };
  const r = crearPaqueteMapaSchema.safeParse({
    nombre,
    bbox,
    ...(brigadaId === '' ? {} : { brigada_id: brigadaId }),
  });
  if (!r.success)
    return {
      ok: false,
      mensaje: r.error.issues.some((i) => i.path[0] === 'nombre')
        ? 'Escriba un nombre de hasta 80 caracteres.'
        : 'Revise los datos del área.',
    };
  return { ok: true, cuerpo: r.data };
};

const NuevaArea = ({
  proyectoId,
  brigadas,
  bbox,
  setBbox,
  marcando,
  setMarcando,
  vista,
  alTerminar,
}: {
  proyectoId: string;
  brigadas: readonly Brigada[];
  bbox: Bbox | null;
  setBbox: (b: Bbox | null) => void;
  marcando: boolean;
  setMarcando: (v: boolean) => void;
  vista: Bbox | null;
  alTerminar: () => void;
}) => {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [brigadaId, setBrigadaId] = useState('');
  const validacion = validarNuevaArea(nombre, bbox, brigadaId);
  const crear = useMutation({
    mutationFn: () => {
      const v = validarNuevaArea(nombre, bbox, brigadaId);
      if (!v.ok) throw new ErrorApi(400, 'DATOS_INVALIDOS', v.mensaje);
      return api.post<PaqueteMapa>(`/proyectos/${proyectoId}/mapas`, v.cuerpo);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['mapas', proyectoId] });
      alTerminar();
    },
  });
  // Sin marcar nada, el aviso de «falta el área» no es un error: solo una indicación.
  const mensajeArea = bbox === null ? null : validacion.ok ? null : validacion.mensaje;
  return (
    <section
      aria-labelledby="titulo-nueva-area"
      className="flex flex-col gap-4 rounded-md border border-linea bg-hoja p-4"
    >
      <h2 id="titulo-nueva-area" className="text-lg font-semibold">
        Nueva área
      </h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          crear.mutate();
        }}
      >
        <Campo etiqueta="Nombre" ayuda="Por ejemplo, «Acceso a la quebrada Honda».">
          {(id) => (
            <input
              id={id}
              value={nombre}
              maxLength={80}
              required
              onChange={(e) => setNombre(e.target.value)}
              className={claseEntrada}
            />
          )}
        </Campo>
        <Campo
          etiqueta="Brigada (opcional)"
          ayuda="Si elige una brigada, el área se ofrece a sus integrantes."
        >
          {(id) => (
            <select
              id={id}
              value={brigadaId}
              onChange={(e) => setBrigadaId(e.target.value)}
              className={claseEntrada}
            >
              <option value="">Todo el proyecto</option>
              {brigadas.map((b) => (
                <option key={b.id} value={b.id}>
                  {nombreBrigada(b)}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Área</legend>
          <div className="flex flex-wrap gap-2">
            <Boton
              variante={marcando ? 'atencion' : 'secundario'}
              aria-pressed={marcando}
              onClick={() => setMarcando(!marcando)}
            >
              {marcando ? 'Dejar de marcar' : 'Marcar en el mapa'}
            </Boton>
            <Boton
              variante="secundario"
              disabled={vista === null}
              onClick={() => {
                setMarcando(false);
                setBbox(vista);
              }}
            >
              Usar el área visible del mapa
            </Boton>
          </div>
          <p className="text-xs text-tinta-suave">
            Marque con dos clics (una esquina y la opuesta) o mueva y acerque el mapa con el teclado
            y use el área visible. Máximo {LADO_MAXIMO_AREA_KM} km por lado.
          </p>
          <p aria-live="polite" className="text-sm">
            {bbox === null ? (
              <span className="text-tinta-suave">Aún no hay un área marcada.</span>
            ) : (
              <>
                <span className="font-semibold">Tamaño: </span>
                {ladosTexto(bbox)}
                {validacion.ok ? (
                  <span className="text-liquen-oscuro"> · ✓ Dentro del límite</span>
                ) : null}
              </>
            )}
          </p>
          {mensajeArea === null ? null : (
            <p
              role="alert"
              className="rounded-md border border-ocre bg-ocre-claro px-3 py-2 text-sm"
            >
              <strong className="font-semibold">Revise el área: </strong>
              {mensajeArea}
            </p>
          )}
        </fieldset>
        <AvisoError error={crear.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Boton variante="secundario" onClick={alTerminar}>
            Cancelar
          </Boton>
          <Boton type="submit" ocupado={crear.isPending} disabled={!validacion.ok}>
            Generar el mapa del área
          </Boton>
        </div>
      </form>
    </section>
  );
};

export const MapasSinConexion = () => {
  const proyectoId = useProyectoId();
  const yo = useYo();
  const qc = useQueryClient();
  const gestionar = puede(yo.data).gestionar;
  const mapas = useQuery({
    queryKey: ['mapas', proyectoId],
    queryFn: () => api.get<{ paquetes: PaqueteMapa[] }>(`/proyectos/${proyectoId}/mapas`),
    enabled: gestionar,
    // Mientras el servidor recorta algún área, se consulta cada 5 s hasta que termine.
    refetchInterval: (q) => (enProceso(q.state.data?.paquetes) ? 5_000 : false),
  });
  const est = useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
    enabled: gestionar,
  });
  const brigadas = useQuery({
    queryKey: ['brigadas', proyectoId],
    queryFn: () => api.get<{ brigadas: Brigada[] }>(`/proyectos/${proyectoId}/brigadas`),
    enabled: gestionar,
  });
  const deBrigadas = useMutation({
    mutationFn: () =>
      api.post<{ paquetes: PaqueteMapa[] }>(`/proyectos/${proyectoId}/mapas/brigadas`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mapas', proyectoId] }),
  });
  const regenerar = useMutation({
    mutationFn: (id: string) => api.post<PaqueteMapa | undefined>(`/mapas/${id}/regenerar`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['mapas', proyectoId] }),
  });

  const [nueva, setNueva] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [vista, setVista] = useState<Bbox | null>(null);

  const paquetes = mapas.data?.paquetes;
  const puntos = useMemo(
    () =>
      (est.data?.estaciones ?? []).map((e): PuntoMapa => ({
        id: e.id,
        lat: e.lat,
        lon: e.lon,
        titulo: e.codigo,
      })),
    [est.data],
  );
  const capas = useMemo(
    () =>
      (paquetes ?? []).map((p): CapaMapa => ({
        id: p.id,
        tipo: 'area',
        etiqueta: p.nombre,
        geometria: poligonoDeBbox(p.bbox),
      })),
    [paquetes],
  );
  const totalListo = (paquetes ?? []).reduce(
    (s, p) => s + (p.estado === 'listo' ? (p.tamano ?? 0) : 0),
    0,
  );

  const terminar = () => {
    setNueva(false);
    setMarcando(false);
    setBbox(null);
  };

  if (yo.isPending) return <Cargando que="sus permisos" />;
  if (!gestionar)
    return (
      <Vacio titulo="Solo Coordinación y Jefe de Proyecto administran los mapas sin conexión">
        Los mapas de su brigada se descargan desde la app del celular, en «Mapas sin conexión».
      </Vacio>
    );

  return (
    <>
      <Encabezado titulo="Mapas sin conexión">
        {nueva ? null : (
          <Boton variante="secundario" onClick={() => setNueva(true)}>
            Nueva área
          </Boton>
        )}
        <Boton ocupado={deBrigadas.isPending} onClick={() => deBrigadas.mutate()}>
          Generar mapas de las brigadas
        </Boton>
      </Encabezado>
      <div className="-mt-3 mb-4 flex max-w-prose flex-col gap-2 text-sm text-tinta-suave">
        <p>
          El servidor recorta el mapa base a cada área para usarlo en el celular sin señal. Los
          celulares descargan las áreas en «Mapas sin conexión» solo con WiFi. Cada área admite
          hasta {ZOOM_MAXIMO_MAPA} de zoom y unos {enMb(TAMANO_MAXIMO_PAQUETE_MAPA)}.
        </p>
        <p>
          «Generar mapas de las brigadas» crea o actualiza un área por brigada con sus estaciones
          del cronograma vigente más {MARGEN_AREA_BRIGADA_KM} km alrededor. Esas áreas se regeneran
          solas al publicar o aprobar cambios del cronograma.
        </p>
      </div>
      <AvisoError error={mapas.error ?? deBrigadas.error ?? regenerar.error ?? est.error} />
      {deBrigadas.data === undefined ? null : (
        <p role="status" className="mb-4 text-sm">
          {deBrigadas.data.paquetes.length === 0
            ? 'Ninguna brigada tiene estaciones en el cronograma vigente: no se generó ningún mapa.'
            : `Se solicitaron ${String(deBrigadas.data.paquetes.length)} mapas de brigada.`}
        </p>
      )}

      <div className={`mb-6 grid gap-4 ${nueva ? 'lg:grid-cols-[1fr_22rem]' : ''}`}>
        <Mapa
          puntos={puntos}
          capas={capas}
          alto="28rem"
          etiqueta="Mapa de las áreas sin conexión y las estaciones"
          marcarRectangulo={nueva && marcando}
          alMarcarRectangulo={(b) => {
            setBbox(b);
            setMarcando(false);
          }}
          rectanguloMarcado={nueva ? bbox : null}
          alCambiarVista={setVista}
        />
        {nueva ? (
          <NuevaArea
            proyectoId={proyectoId}
            brigadas={brigadas.data?.brigadas ?? []}
            bbox={bbox}
            setBbox={setBbox}
            marcando={marcando}
            setMarcando={setMarcando}
            vista={vista}
            alTerminar={terminar}
          />
        ) : null}
      </div>
      <p className="mb-2 text-xs text-tinta-suave">
        En el mapa: cada área con borde discontinuo y su nombre; las estaciones como puntos; el área
        que está marcando, en ocre.
      </p>

      {mapas.isPending ? <Cargando que="los mapas" /> : null}
      {paquetes?.length === 0 ? (
        <Vacio titulo="Aún no hay mapas sin conexión">
          Genere los mapas de las brigadas o marque una nueva área.
        </Vacio>
      ) : null}
      {paquetes !== undefined && paquetes.length > 0 ? (
        <>
          <p className="mb-2 text-sm text-tinta-suave">
            {paquetes.length} {paquetes.length === 1 ? 'área' : 'áreas'}; listas: {enMb(totalListo)}{' '}
            en total.
            {enProceso(paquetes) ? ' Se actualiza sola mientras alguna se genera.' : ''}
          </p>
          <Tabla titulo="Áreas de mapa sin conexión">
            <thead>
              <tr>
                <th className={th}>Nombre</th>
                <th className={th}>Brigada</th>
                <th className={th}>Origen</th>
                <th className={th}>Estado</th>
                <th className={th}>Tamaño</th>
                <th className={th}>Zoom máx.</th>
                <th className={th}>Versión</th>
                <th className={th}>Solicitado por</th>
                <th className={th}>Celulares al día</th>
                <th className={th}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paquetes.map((p) => (
                <tr key={p.id}>
                  <td className={`${td} font-semibold`}>
                    {p.nombre}
                    <span className="block text-xs font-normal text-tinta-suave">
                      {ladosTexto(p.bbox)}
                    </span>
                  </td>
                  <td className={td}>{p.brigada_nombre ?? 'Todo el proyecto'}</td>
                  <td className={td}>
                    {p.origen === 'brigada' ? 'Brigada automática' : 'Marcada por usuario'}
                  </td>
                  <td className={td}>
                    <EstadoPaquete p={p} />
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {p.tamano === null ? '—' : enMb(p.tamano)}
                  </td>
                  <td className={td}>{p.zoom_max}</td>
                  <td className={td}>
                    v{p.version}
                    <span className="block text-xs text-tinta-suave">
                      {p.generado_en === null ? 'Sin generar' : fechaHora(p.generado_en)}
                    </span>
                  </td>
                  <td className={td}>{p.solicitado_por_nombre ?? 'Sistema'}</td>
                  <td className={td}>{p.descargas}</td>
                  <td className={td}>
                    <Boton
                      variante="secundario"
                      ocupado={regenerar.isPending && regenerar.variables === p.id}
                      disabled={p.estado === 'pendiente' || p.estado === 'generando'}
                      aria-label={`Regenerar ${p.nombre}`}
                      onClick={() => regenerar.mutate(p.id)}
                    >
                      Regenerar
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </>
      ) : null}
    </>
  );
};
