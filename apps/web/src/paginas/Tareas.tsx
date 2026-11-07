import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  api,
  type Cuaderno,
  type Cuadrilla,
  type DetalleTarea as Detalle,
  type EstadoTarea,
  type Estacion,
  type FilaTarea,
} from '../api.ts';
import { Estado, ETIQUETA_ESTADO } from '../componentes/Estado.tsx';
import { Mapa } from '../componentes/MapaDiferido.tsx';
import {
  AvisoError,
  Boton,
  Campo,
  Cargando,
  claseEntrada,
  Dialogo,
  Encabezado,
  fechaHora,
  Tabla,
  td,
  th,
  Vacio,
} from '../componentes/Ui.tsx';
import { puede, useYo } from '../sesion.ts';
import { FormularioDialogo, useProyectoId } from './Proyectos.tsx';

const ESTADOS = Object.keys(ETIQUETA_ESTADO) as EstadoTarea[];

// ── Centro de tareas ──

export const Tareas = () => {
  const proyectoId = useProyectoId();
  const yo = useYo();
  const qc = useQueryClient();
  const [estado, setEstado] = useState<EstadoTarea | ''>('');
  const [cuadrilla, setCuadrilla] = useState('');
  const [tipo, setTipo] = useState<'' | 'tecnica' | 'logistica'>('');
  const [paginas, setPaginas] = useState<string[]>([]);
  const cursor = paginas.at(-1);

  const filtros = new URLSearchParams({ limite: '50' });
  if (estado !== '') filtros.set('estado', estado);
  if (cuadrilla !== '') filtros.set('cuadrilla_id', cuadrilla);
  if (tipo !== '') filtros.set('tipo', tipo);
  if (cursor !== undefined) filtros.set('despues_de', cursor);

  const q = useQuery({
    queryKey: ['tareas', proyectoId, filtros.toString()],
    queryFn: () =>
      api.get<{ tareas: FilaTarea[]; siguiente: string | null }>(
        `/proyectos/${proyectoId}/tareas?${filtros.toString()}`,
      ),
  });
  const cuadrillas = useQuery({
    queryKey: ['cuadrillas', proyectoId],
    queryFn: () => api.get<{ cuadrillas: Cuadrilla[] }>(`/proyectos/${proyectoId}/cuadrillas`),
  });
  const cuadernos = useQuery({
    queryKey: ['cuadernos', proyectoId],
    queryFn: () => api.get<{ cuadernos: Cuaderno[] }>(`/proyectos/${proyectoId}/cuadernos`),
  });
  const estaciones = useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
  });

  const [nueva, setNueva] = useState({
    cuaderno: '',
    titulo: '',
    descripcion: '',
    tipo: 'tecnica',
    estacion: '',
    metodologia: '',
    lat: '',
    lon: '',
  });
  const estacionElegida = estaciones.data?.estaciones.find((s) => s.id === nueva.estacion);
  const reiniciar = () => setPaginas([]);

  return (
    <>
      <Encabezado titulo="Centro de tareas">
        {puede(yo.data).gestionarTareas ? (
          <FormularioDialogo
            titulo="Nueva tarea"
            boton="Crear tarea"
            abrir="Nueva tarea"
            alGuardar={async () => {
              await api.post('/tareas', {
                cuaderno_id: nueva.cuaderno,
                titulo: nueva.titulo,
                descripcion: nueva.descripcion === '' ? null : nueva.descripcion,
                tipo: nueva.tipo,
                estacion_id: nueva.estacion === '' ? null : nueva.estacion,
                metodologia_id: nueva.metodologia === '' ? null : nueva.metodologia,
                ubicacion:
                  nueva.lat === '' || nueva.lon === ''
                    ? null
                    : { lat: Number(nueva.lat), lon: Number(nueva.lon) },
              });
              setNueva({ ...nueva, titulo: '', descripcion: '' });
              await qc.invalidateQueries({ queryKey: ['tareas', proyectoId] });
            }}
          >
            <Campo
              etiqueta="Cuaderno"
              ayuda="La tarea llega al celular del responsable del cuaderno."
            >
              {(id) => (
                <select
                  id={id}
                  value={nueva.cuaderno}
                  onChange={(e) => setNueva({ ...nueva, cuaderno: e.target.value })}
                  required
                  className={claseEntrada}
                >
                  <option value="">Elija un cuaderno</option>
                  {cuadernos.data?.cuadernos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.titulo}, de {c.responsable_nombre}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
            <Campo etiqueta="Título">
              {(id) => (
                <input
                  id={id}
                  value={nueva.titulo}
                  onChange={(e) => setNueva({ ...nueva, titulo: e.target.value })}
                  required
                  className={claseEntrada}
                />
              )}
            </Campo>
            <Campo etiqueta="Indicaciones" ayuda="Opcional. Qué evidencias se esperan.">
              {(id) => (
                <textarea
                  id={id}
                  value={nueva.descripcion}
                  onChange={(e) => setNueva({ ...nueva, descripcion: e.target.value })}
                  rows={3}
                  className={`${claseEntrada} py-2`}
                />
              )}
            </Campo>
            <Campo etiqueta="Tipo">
              {(id) => (
                <select
                  id={id}
                  value={nueva.tipo}
                  onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })}
                  className={claseEntrada}
                >
                  <option value="tecnica">Técnica (especialista)</option>
                  <option value="logistica">Logística (responsable logístico)</option>
                </select>
              )}
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Estación">
                {(id) => (
                  <select
                    id={id}
                    value={nueva.estacion}
                    onChange={(e) =>
                      setNueva({ ...nueva, estacion: e.target.value, metodologia: '' })
                    }
                    className={claseEntrada}
                  >
                    <option value="">Sin estación</option>
                    {estaciones.data?.estaciones.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.codigo}
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
              <Campo etiqueta="Metodología">
                {(id) => (
                  <select
                    id={id}
                    value={nueva.metodologia}
                    onChange={(e) => setNueva({ ...nueva, metodologia: e.target.value })}
                    disabled={estacionElegida === undefined}
                    className={claseEntrada}
                  >
                    <option value="">Sin metodología</option>
                    {estacionElegida?.metodologias.map((m) => (
                      <option key={m.metodologia_id} value={m.metodologia_id}>
                        {m.nombre}
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
            </div>
            {nueva.estacion === '' ? (
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Latitud" ayuda="Para el aviso de cercanía.">
                  {(id) => (
                    <input
                      id={id}
                      value={nueva.lat}
                      onChange={(e) => setNueva({ ...nueva, lat: e.target.value })}
                      inputMode="decimal"
                      className={claseEntrada}
                    />
                  )}
                </Campo>
                <Campo etiqueta="Longitud">
                  {(id) => (
                    <input
                      id={id}
                      value={nueva.lon}
                      onChange={(e) => setNueva({ ...nueva, lon: e.target.value })}
                      inputMode="decimal"
                      className={claseEntrada}
                    />
                  )}
                </Campo>
              </div>
            ) : null}
          </FormularioDialogo>
        ) : null}
      </Encabezado>

      <div className="mb-4 flex flex-wrap gap-3" role="group" aria-label="Filtros">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Estado
          <select
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value as EstadoTarea | '');
              reiniciar();
            }}
            className={`${claseEntrada} w-52 font-normal`}
          >
            <option value="">Todos</option>
            {ESTADOS.map((s) => (
              <option key={s} value={s}>
                {ETIQUETA_ESTADO[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Cuadrilla
          <select
            value={cuadrilla}
            onChange={(e) => {
              setCuadrilla(e.target.value);
              reiniciar();
            }}
            className={`${claseEntrada} w-52 font-normal`}
          >
            <option value="">Todas</option>
            {cuadrillas.data?.cuadrillas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Tipo
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as '' | 'tecnica' | 'logistica');
              reiniciar();
            }}
            className={`${claseEntrada} w-44 font-normal`}
          >
            <option value="">Todos</option>
            <option value="tecnica">Técnica</option>
            <option value="logistica">Logística</option>
          </select>
        </label>
      </div>

      {q.isPending ? <Cargando que="las tareas" /> : null}
      <AvisoError error={q.error} />
      {q.data?.tareas.length === 0 ? (
        <Vacio
          titulo={
            estado === '' && cuadrilla === '' && tipo === ''
              ? 'Aún no hay tareas en este proyecto'
              : 'Ninguna tarea cumple estos filtros'
          }
        >
          {estado === '' && cuadrilla === '' && tipo === ''
            ? 'Cree un cuaderno en Equipo y cuadernos, y luego una tarea con Nueva tarea.'
            : 'Cambie o quite los filtros.'}
        </Vacio>
      ) : null}
      {q.data !== undefined && q.data.tareas.length > 0 ? (
        <>
          <Tabla titulo="Tareas del proyecto">
            <thead>
              <tr>
                <th className={th}>Tarea</th>
                <th className={th}>Estado</th>
                <th className={th}>Responsable</th>
                <th className={th}>Cuadrilla</th>
                <th className={th}>Actualizada</th>
              </tr>
            </thead>
            <tbody>
              {q.data.tareas.map((t) => (
                <tr key={t.id} className="hover:bg-papel">
                  <td className={td}>
                    <Link
                      to="/p/$proyectoId/tareas/$tareaId"
                      params={{ proyectoId, tareaId: t.id }}
                      className="font-semibold text-liquen-oscuro underline-offset-4 hover:underline"
                    >
                      {t.titulo}
                    </Link>
                    <div className="text-xs text-tinta-suave">
                      {t.cuaderno_titulo}
                      {t.origen === 'regla' ? ', generada por una regla' : ''}
                    </div>
                  </td>
                  <td className={td}>
                    <Estado estado={t.estado} />
                  </td>
                  <td className={td}>{t.responsable_nombre}</td>
                  <td className={td}>{t.cuadrilla_nombre}</td>
                  <td className={`${td} cifras whitespace-nowrap text-tinta-suave`}>
                    {fechaHora(t.actualizado_en)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
          <div className="mt-3 flex gap-2">
            <Boton
              variante="secundario"
              disabled={paginas.length === 0}
              onClick={() => setPaginas(paginas.slice(0, -1))}
            >
              Anteriores
            </Boton>
            <Boton
              variante="secundario"
              disabled={q.data.siguiente === null}
              onClick={() => {
                if (q.data.siguiente !== null) setPaginas([...paginas, q.data.siguiente]);
              }}
            >
              Siguientes
            </Boton>
          </div>
        </>
      ) : null}
    </>
  );
};

// ── Detalle de la tarea ──

const Foto = ({
  archivo,
  alAbrir,
}: {
  archivo: Detalle['archivos'][number];
  alAbrir: (id: string) => void;
}) => {
  const verificada =
    archivo.estado === 'preview_verificada' || archivo.estado === 'original_verificado';
  const mini = useQuery({
    queryKey: ['url', archivo.id, 'miniatura'],
    queryFn: () => api.get<{ url: string }>(`/archivos/${archivo.id}/url?variante=miniatura`),
    enabled: verificada && archivo.tiene_miniatura,
    staleTime: 10 * 60_000,
  });
  return (
    <figure className="flex flex-col gap-1">
      <button
        type="button"
        disabled={!verificada || archivo.tipo === 'audio'}
        onClick={() => alAbrir(archivo.id)}
        className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-linea bg-papel text-xs text-tinta-suave"
        aria-label={
          verificada
            ? `Ver ${archivo.tipo} capturada el ${fechaHora(archivo.capturado_en)}`
            : 'Archivo aún no recibido'
        }
      >
        {mini.data !== undefined ? (
          <img src={mini.data.url} alt="" className="size-full object-cover" />
        ) : verificada ? (
          archivo.tipo === 'audio' ? (
            'Nota de voz'
          ) : (
            'Sin miniatura'
          )
        ) : (
          'Aún en el celular'
        )}
      </button>
      <figcaption className="text-xs text-tinta-suave">
        {fechaHora(archivo.capturado_en)}
        {archivo.precision_m === null ? '' : `, ±${String(Math.round(archivo.precision_m))} m`}
      </figcaption>
    </figure>
  );
};

type Accion = 'validar' | 'observar' | 'revocar' | 'reabrir' | 'cerrar' | null;

const TEXTOS_ACCION: Readonly<
  Record<
    Exclude<Accion, null>,
    { titulo: string; boton: string; campo: string; obligatorio: boolean }
  >
> = {
  validar: {
    titulo: 'Validar la tarea',
    boton: 'Validar',
    campo: 'Comentario (opcional)',
    obligatorio: false,
  },
  observar: {
    titulo: 'Observar la tarea',
    boton: 'Enviar observación',
    campo: 'Qué debe corregir el responsable',
    obligatorio: true,
  },
  revocar: {
    titulo: 'Revocar la asignación',
    boton: 'Revocar',
    campo: 'Motivo de la revocación',
    obligatorio: true,
  },
  reabrir: {
    titulo: 'Reabrir la tarea',
    boton: 'Reabrir',
    campo: 'Motivo para reabrir',
    obligatorio: true,
  },
  cerrar: {
    titulo: 'Cerrar sin foto',
    boton: 'Cerrar tarea',
    campo: 'Comentario de cierre',
    obligatorio: true,
  },
};

const ETIQUETA_EVENTO: Readonly<Record<string, string>> = {
  evidencia_item_creado: 'Punto de evidencia',
  archivo_capturado: 'Foto o archivo',
  tarea_completada: 'Completada en el celular',
  comentario_creado: 'Comentario desde el celular',
  esfuerzo_registrado: 'Esfuerzo registrado',
  validacion_registrada: 'Validación',
  observacion_validacion: 'Observación',
  asignacion_revocada: 'Asignación revocada',
  tarea_reasignada: 'Reasignada',
  tarea_reabierta: 'Reabierta',
  tarea_cerrada: 'Cerrada en la web',
};

const ETIQUETA_RESULTADO: Readonly<Record<string, string>> = {
  aplicado: 'Aplicado',
  ya_aplicado: 'Ya estaba aplicado',
  no_aplicado: 'No aplicado',
  en_revision: 'En revisión',
  duplicado: 'Duplicado',
  resuelto_elegido: 'Resuelto: se conserva',
  resuelto_descartado: 'Resuelto: se descarta',
};

export const DetalleTarea = () => {
  const { proyectoId, tareaId } = useParams({ from: '/p/$proyectoId/tareas/$tareaId' });
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['tarea', tareaId],
    queryFn: () => api.get<Detalle>(`/tareas/${tareaId}`),
  });
  const [accion, setAccion] = useState<Accion>(null);
  const [texto, setTexto] = useState('');
  const [comentario, setComentario] = useState('');
  const [fotoAbierta, setFotoAbierta] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ['url', fotoAbierta, 'preview'],
    queryFn: () => api.get<{ url: string }>(`/archivos/${fotoAbierta ?? ''}/url?variante=preview`),
    enabled: fotoAbierta !== null,
    staleTime: 10 * 60_000,
  });

  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: ['tarea', tareaId] });
    await qc.invalidateQueries({ queryKey: ['tareas', proyectoId] });
  };
  const ejecutar = useMutation({
    mutationFn: async (a: Exclude<Accion, null>) => {
      const cuerpo =
        a === 'validar'
          ? { comentario: texto === '' ? null : texto }
          : a === 'revocar' || a === 'reabrir'
            ? { motivo: texto }
            : { comentario: texto };
      return api.post(`/tareas/${tareaId}/${a}`, cuerpo);
    },
    onSuccess: async () => {
      setAccion(null);
      setTexto('');
      await refrescar();
    },
  });
  const comentar = useMutation({
    mutationFn: () => api.post(`/tareas/${tareaId}/comentarios`, { texto: comentario }),
    onSuccess: async () => {
      setComentario('');
      await refrescar();
    },
  });

  if (q.isPending) return <Cargando que="la tarea" />;
  if (q.data === undefined) return <AvisoError error={q.error} />;
  const { tarea: t, archivos, comentarios, eventos, asignaciones, evidencias, permisos } = q.data;
  const g = permisos.gestionar;
  const disponibles: Exclude<Accion, null>[] = [];
  if (g && t.estado === 'completada' && t.validacion_activa)
    disponibles.push('validar', 'observar');
  if (g && t.estado === 'descargada') disponibles.push('revocar');
  if (g && (t.estado === 'completada' || t.estado === 'validada')) disponibles.push('reabrir');
  if (g && t.estado === 'asignada' && t.origen === 'regla') disponibles.push('cerrar');
  const fotos = archivos.filter((a) => a.tipo !== 'audio');

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link
          to="/p/$proyectoId"
          params={{ proyectoId }}
          className="text-liquen underline-offset-4 hover:underline"
        >
          Centro de tareas
        </Link>
      </p>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{t.titulo}</h2>
          <div className="mt-2">
            <Estado estado={t.estado} />
          </div>
        </div>
        {disponibles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {disponibles.map((a) => (
              <Boton
                key={a}
                variante={
                  a === 'validar'
                    ? 'principal'
                    : a === 'revocar'
                      ? 'peligro'
                      : a === 'observar'
                        ? 'atencion'
                        : 'secundario'
                }
                onClick={() => setAccion(a)}
              >
                {TEXTOS_ACCION[a].boton}
              </Boton>
            ))}
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-linea bg-hoja p-4 text-sm sm:grid-cols-2">
            {[
              ['Responsable', t.responsable_nombre],
              ['Cuadrilla', t.cuadrilla_nombre],
              ['Cuaderno', t.cuaderno_titulo],
              ['Origen', t.origen === 'regla' ? 'Generada por una regla' : 'Creada en la web'],
              ['Estación', t.estacion_codigo ?? 'Sin estación'],
              ['Metodología', t.metodologia_nombre ?? 'Sin metodología'],
              ['Validación', t.validacion_activa ? 'Activa' : 'No requerida'],
              ['Creada', fechaHora(t.creado_en)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-tinta-suave">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
            {t.descripcion === null ? null : (
              <div className="sm:col-span-2">
                <dt className="text-tinta-suave">Indicaciones</dt>
                <dd className="whitespace-pre-line">{t.descripcion}</dd>
              </div>
            )}
          </dl>

          <section>
            <h3 className="mb-3 text-lg font-semibold">Evidencias</h3>
            {evidencias.length > 0 ? (
              <p className="mb-3 text-sm text-tinta-suave">
                Puntos: {evidencias.map((e) => e.descripcion).join(', ')}
              </p>
            ) : null}
            {fotos.length === 0 ? (
              <Vacio titulo="Sin fotos todavía">
                Las fotos aparecen cuando el celular sincroniza y el servidor verifica cada archivo.
              </Vacio>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {fotos.map((a) => (
                  <Foto key={a.id} archivo={a} alAbrir={setFotoAbierta} />
                ))}
              </div>
            )}
          </section>

          {t.lat !== null && t.lon !== null ? (
            <section>
              <h3 className="mb-3 text-lg font-semibold">Ubicación</h3>
              <Mapa
                alto="18rem"
                puntos={[
                  {
                    id: t.id,
                    lat: t.lat,
                    lon: t.lon,
                    capa: 'tarea',
                    titulo: t.titulo,
                    estado: t.estado,
                  },
                  ...archivos
                    .filter((a) => a.lat !== null && a.lon !== null)
                    .map((a) => ({
                      id: a.id,
                      lat: a.lat ?? 0,
                      lon: a.lon ?? 0,
                      capa: 'estacion' as const,
                      titulo: 'Foto',
                    })),
                ]}
              />
              <p className="mt-1 text-xs text-tinta-suave">
                Punto de color: la tarea. Círculos blancos: dónde se tomó cada foto.
              </p>
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6">
          <section>
            <h3 className="mb-3 text-lg font-semibold">Comentarios</h3>
            <ul className="mb-3 flex flex-col gap-3">
              {comentarios.length === 0 ? (
                <li className="text-sm text-tinta-suave">Sin comentarios.</li>
              ) : null}
              {comentarios.map((c) => (
                <li key={c.id} className="rounded-md border border-linea bg-hoja p-3 text-sm">
                  <p className="whitespace-pre-line">{c.texto}</p>
                  <p className="mt-1 text-xs text-tinta-suave">
                    {c.autor_nombre}, {fechaHora(c.creado_en)}
                  </p>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                comentar.mutate();
              }}
              className="flex flex-col gap-2"
            >
              <label htmlFor="nuevo-comentario" className="text-sm font-semibold">
                Agregar un comentario
              </label>
              <textarea
                id="nuevo-comentario"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                rows={3}
                className={`${claseEntrada} py-2`}
              />
              <AvisoError error={comentar.error} />
              <Boton
                type="submit"
                variante="secundario"
                ocupado={comentar.isPending}
                disabled={comentario.trim() === ''}
              >
                Comentar
              </Boton>
            </form>
          </section>

          <section>
            <h3 className="mb-3 text-lg font-semibold">Historial</h3>
            <ol className="flex flex-col gap-2 border-l-2 border-linea pl-4 text-sm">
              {asignaciones.map((a) => (
                <li key={a.id}>
                  <p className="font-medium">Descargada por {a.usuario_nombre}</p>
                  <p className="text-xs text-tinta-suave">
                    {fechaHora(a.descargada_en)}. Asignación {a.estado}
                    {a.motivo_revocacion === null ? '' : `: ${a.motivo_revocacion}`}
                  </p>
                </li>
              ))}
              {eventos.map((ev) => (
                <li key={ev.id}>
                  <p className="font-medium">{ETIQUETA_EVENTO[ev.tipo] ?? ev.tipo}</p>
                  <p className="text-xs text-tinta-suave">
                    {ev.usuario_nombre}, {fechaHora(ev.hora_servidor)}.{' '}
                    {ETIQUETA_RESULTADO[ev.estado] ?? ev.estado}
                    {ev.motivo === null ? '' : ` (${ev.motivo})`}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <Dialogo
        abierto={accion !== null}
        titulo={accion === null ? '' : TEXTOS_ACCION[accion].titulo}
        alCerrar={() => setAccion(null)}
      >
        {accion === null ? null : (
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              ejecutar.mutate(accion);
            }}
            className="flex flex-col gap-4"
          >
            <Campo etiqueta={TEXTOS_ACCION[accion].campo}>
              {(id) => (
                <textarea
                  id={id}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={3}
                  required={TEXTOS_ACCION[accion].obligatorio}
                  className={`${claseEntrada} py-2`}
                />
              )}
            </Campo>
            <AvisoError error={ejecutar.error} />
            <div className="flex justify-end gap-2">
              <Boton variante="secundario" onClick={() => setAccion(null)}>
                Cancelar
              </Boton>
              <Boton
                type="submit"
                ocupado={ejecutar.isPending}
                disabled={TEXTOS_ACCION[accion].obligatorio && texto.trim() === ''}
              >
                {TEXTOS_ACCION[accion].boton}
              </Boton>
            </div>
          </form>
        )}
      </Dialogo>

      <Dialogo
        abierto={fotoAbierta !== null}
        titulo="Foto de evidencia"
        alCerrar={() => setFotoAbierta(null)}
      >
        {preview.isPending ? <Cargando que="la foto" /> : null}
        <AvisoError error={preview.error} />
        {preview.data === undefined ? null : (
          <img
            src={preview.data.url}
            alt="Foto de evidencia en 2 048 px"
            className="w-full rounded-md"
          />
        )}
      </Dialogo>
    </div>
  );
};
