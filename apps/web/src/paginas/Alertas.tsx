import {
  CATEGORIAS_ALERTA_LOGISTICA,
  ETIQUETA_CATEGORIA_LOGISTICA,
  type CategoriaAlertaLogistica,
} from '@campo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  api,
  type AlertaDetalle,
  type AlertaFila,
  type Brigada,
  type EstadoAlerta,
  type Estacion,
  type TipoAlerta,
  type TipoMensajeAlerta,
} from '../api.ts';
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
import { useProyectoId } from './Proyectos.tsx';

/**
 * Bandeja de alertas (D02 §9 y §11, RF-W03, RN-36): registros estructurados de excepción con tipo,
 * estado, historial, consultas, respuestas y cierre. No es un chat ni una lista de pendientes.
 * Los botones son una pista: la API autoriza cada acción por rol y alcance.
 */

const TIPO: Readonly<Record<TipoAlerta, string>> = {
  tecnica: 'Técnica',
  logistica: 'Logística',
  post_sincronizacion: 'Post-sincronización',
};

/** El estado se lee por el texto y el icono; el color solo acompaña. */
const ESTADO: Readonly<Record<EstadoAlerta, { texto: string; icono: string; clase: string }>> = {
  abierta: { texto: 'Abierta', icono: '●', clase: 'border-ocre bg-ocre-claro text-tinta' },
  pendiente_respuesta: {
    texto: 'Pendiente de respuesta',
    icono: '?',
    clase: 'border-oxido bg-oxido-claro text-tinta',
  },
  cerrada: { texto: 'Cerrada', icono: '✓', clase: 'border-linea bg-liquen-claro text-tinta' },
};

const MENSAJE: Readonly<Record<TipoMensajeAlerta, string>> = {
  respuesta: 'Respuesta',
  complemento: 'Complemento',
  consulta: 'Consulta',
  cierre: 'Cierre',
  reapertura: 'Reapertura',
};

const esCategoria = (c: string): c is CategoriaAlertaLogistica =>
  (CATEGORIAS_ALERTA_LOGISTICA as readonly string[]).includes(c);
const categoria = (c: string | null): string | null =>
  c === null ? null : esCategoria(c) ? ETIQUETA_CATEGORIA_LOGISTICA[c] : c;

const EtiquetaEstado = ({ estado }: { estado: EstadoAlerta }) => {
  const e = ESTADO[estado];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${e.clase}`}
    >
      <span aria-hidden="true">{e.icono}</span>
      {e.texto}
    </span>
  );
};

const TipoTexto = ({ a }: { a: Pick<AlertaFila, 'tipo' | 'categoria' | 'afecta_cronograma'> }) => (
  <>
    <span className="font-semibold">{TIPO[a.tipo]}</span>
    {a.categoria === null ? null : <span> · {categoria(a.categoria)}</span>}
    {a.afecta_cronograma ? (
      <span className="block text-xs text-tinta-suave">Afecta el cronograma</span>
    ) : null}
  </>
);

const autor = (a: Pick<AlertaFila, 'origen' | 'autor_nombre'>): string =>
  a.origen === 'sistema' ? 'Sistema' : (a.autor_nombre ?? '—');

export const Alertas = () => {
  const proyectoId = useProyectoId();
  const p = puede(useYo().data);
  const [estado, setEstado] = useState<EstadoAlerta | ''>('');
  const [tipo, setTipo] = useState<TipoAlerta | ''>('');
  const [brigada, setBrigada] = useState('');
  const [elegida, setElegida] = useState<string | null>(null);

  const brigadas = useQuery({
    queryKey: ['brigadas', proyectoId],
    queryFn: () => api.get<{ brigadas: Brigada[] }>(`/proyectos/${proyectoId}/brigadas`),
  });
  const filtro = new URLSearchParams({
    ...(estado === '' ? {} : { estado }),
    ...(tipo === '' ? {} : { tipo }),
    ...(brigada === '' ? {} : { brigada }),
  }).toString();
  const q = useQuery({
    queryKey: ['alertas', proyectoId, filtro],
    queryFn: () =>
      api.get<{ alertas: AlertaFila[] }>(
        `/proyectos/${proyectoId}/alertas${filtro === '' ? '' : `?${filtro}`}`,
      ),
  });

  return (
    <>
      <Encabezado titulo="Alertas">
        {p.gestionar ? <NuevaAlerta brigadas={brigadas.data?.brigadas ?? []} /> : null}
      </Encabezado>
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Excepciones técnicas, logísticas y de la revisión posterior a la sincronización. Solo se
        muestran las que ya llegaron al servidor: lo que aún está en un celular sin señal aparecerá
        al sincronizar.
      </p>
      <form
        className="mb-4 grid gap-3 sm:grid-cols-3"
        aria-label="Filtros de alertas"
        onSubmit={(ev) => ev.preventDefault()}
      >
        <Campo etiqueta="Estado">
          {(id) => (
            <select
              id={id}
              className={claseEntrada}
              value={estado}
              onChange={(ev) => setEstado(ev.target.value as EstadoAlerta | '')}
            >
              <option value="">Todos</option>
              {(Object.keys(ESTADO) as EstadoAlerta[]).map((k) => (
                <option key={k} value={k}>
                  {ESTADO[k].texto}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Tipo">
          {(id) => (
            <select
              id={id}
              className={claseEntrada}
              value={tipo}
              onChange={(ev) => setTipo(ev.target.value as TipoAlerta | '')}
            >
              <option value="">Todos</option>
              {(Object.keys(TIPO) as TipoAlerta[]).map((k) => (
                <option key={k} value={k}>
                  {TIPO[k]}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Brigada">
          {(id) => (
            <select
              id={id}
              className={claseEntrada}
              value={brigada}
              onChange={(ev) => setBrigada(ev.target.value)}
            >
              <option value="">Todas</option>
              {(brigadas.data?.brigadas ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                </option>
              ))}
            </select>
          )}
        </Campo>
      </form>

      {q.isPending ? <Cargando que="las alertas" /> : null}
      <AvisoError error={q.error} />
      {q.data?.alertas.length === 0 ? (
        <Vacio titulo="No hay alertas con estos filtros">
          Las alertas que registren las brigadas aparecerán aquí al sincronizar sus celulares.
        </Vacio>
      ) : null}
      {q.data !== undefined && q.data.alertas.length > 0 ? (
        <Tabla titulo="Alertas del proyecto">
          <thead>
            <tr>
              <th className={th}>Tipo</th>
              <th className={th}>Estado</th>
              <th className={th}>Alerta</th>
              <th className={th}>Estación</th>
              <th className={th}>Brigada</th>
              <th className={th}>Registrada por</th>
              <th className={th}>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {q.data.alertas.map((a) => (
              <tr key={a.id} className={a.id === elegida ? 'bg-liquen-claro' : undefined}>
                <td className={td}>
                  <TipoTexto a={a} />
                </td>
                <td className={td}>
                  <EtiquetaEstado estado={a.estado} />
                </td>
                <td className={td}>
                  <button
                    type="button"
                    className="min-h-11 text-left font-semibold text-liquen underline-offset-4 hover:underline"
                    aria-pressed={a.id === elegida}
                    onClick={() => setElegida(a.id === elegida ? null : a.id)}
                  >
                    {a.titulo}
                  </button>
                </td>
                <td className={td}>{a.estacion_codigo ?? '—'}</td>
                <td className={td}>{a.brigada_nombre ?? '—'}</td>
                <td className={td}>{autor(a)}</td>
                <td className={`${td} cifras whitespace-nowrap`}>
                  {fechaHora(a.hora_dispositivo ?? a.creado_en)}
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}
      {elegida === null ? null : (
        <Detalle key={elegida} id={elegida} alCerrar={() => setElegida(null)} />
      )}
    </>
  );
};

// ── Detalle con historial ──

const Detalle = ({ id, alCerrar }: { id: string; alCerrar: () => void }) => {
  const proyectoId = useProyectoId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['alerta', id],
    queryFn: () => api.get<AlertaDetalle>(`/alertas/${id}`),
  });
  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: ['alerta', id] });
    await qc.invalidateQueries({ queryKey: ['alertas', proyectoId] });
  };
  const [tipoMensaje, setTipoMensaje] = useState<'respuesta' | 'complemento' | 'consulta'>(
    'respuesta',
  );
  const [texto, setTexto] = useState('');
  const [comentario, setComentario] = useState('');
  const mensaje = useMutation({
    mutationFn: (t: 'respuesta' | 'complemento' | 'consulta') =>
      api.post(`/alertas/${id}/mensajes`, { tipo: t, texto }),
    onSuccess: async () => {
      setTexto('');
      await refrescar();
    },
  });
  const cerrar = useMutation({
    mutationFn: () =>
      api.post(`/alertas/${id}/cerrar`, {
        comentario: comentario.trim() === '' ? null : comentario,
      }),
    onSuccess: async () => {
      setComentario('');
      await refrescar();
    },
  });
  const reabrir = useMutation({
    mutationFn: () => api.post(`/alertas/${id}/reabrir`, { motivo: comentario }),
    onSuccess: async () => {
      setComentario('');
      await refrescar();
    },
  });

  if (q.isPending) return <Cargando que="la alerta" />;
  if (q.data === undefined) return <AvisoError error={q.error} />;
  const a = q.data;
  const opciones: { valor: 'respuesta' | 'complemento' | 'consulta'; texto: string }[] = [
    ...(a.permisos.puede_responder
      ? [
          { valor: 'respuesta' as const, texto: 'Respuesta' },
          { valor: 'complemento' as const, texto: 'Complemento' },
        ]
      : []),
    ...(a.permisos.puede_consultar
      ? [{ valor: 'consulta' as const, texto: 'Consulta (pide respuesta)' }]
      : []),
  ];
  const tipoVigente = opciones.some((o) => o.valor === tipoMensaje)
    ? tipoMensaje
    : opciones[0]?.valor;

  return (
    <section
      aria-labelledby="titulo-alerta"
      className="mt-6 rounded-md border border-linea bg-hoja p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="titulo-alerta" className="text-lg font-semibold">
            {a.titulo}
          </h2>
          <p className="mt-1 text-sm">
            <TipoTexto a={a} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <EtiquetaEstado estado={a.estado} />
          <Boton variante="secundario" onClick={alCerrar}>
            Ocultar detalle
          </Boton>
        </div>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Dato termino="Estación" valor={a.estacion_codigo} />
        <Dato termino="Brigada" valor={a.brigada_nombre} />
        <Dato termino="Método" valor={a.metodo_nombre} />
        <Dato termino="Registrada por" valor={autor(a)} />
        <Dato
          termino="Hora en el celular"
          valor={a.hora_dispositivo === null ? null : fechaHora(a.hora_dispositivo)}
        />
        <Dato termino="Recibida" valor={fechaHora(a.creado_en)} />
        {a.cerrado_en === null ? null : (
          <Dato
            termino="Cerrada"
            valor={`${fechaHora(a.cerrado_en)} · ${a.cerrado_por_nombre ?? '—'}`}
          />
        )}
      </dl>
      {a.descripcion === null ? null : (
        <p className="mt-4 max-w-prose whitespace-pre-line text-sm">{a.descripcion}</p>
      )}

      <h3 className="mt-6 font-semibold">Historial</h3>
      {a.mensajes.length === 0 ? (
        <p className="mt-2 text-sm text-tinta-suave">Aún no hay respuestas ni consultas.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2">
          {a.mensajes.map((m) => (
            <li key={m.id} className="rounded-md border border-linea px-3 py-2 text-sm">
              <p className="text-xs text-tinta-suave">
                <span className="font-semibold text-tinta">{MENSAJE[m.tipo]}</span> ·{' '}
                {m.autor_nombre} · <span className="cifras">{fechaHora(m.creado_en)}</span>
              </p>
              <p className="mt-1 whitespace-pre-line">{m.texto}</p>
            </li>
          ))}
        </ol>
      )}

      <AvisoError error={mensaje.error ?? cerrar.error ?? reabrir.error} />

      {tipoVigente === undefined ? null : (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            mensaje.mutate(tipoVigente);
          }}
        >
          <Campo etiqueta="Tipo de mensaje">
            {(fid) => (
              <select
                id={fid}
                className={claseEntrada}
                value={tipoVigente}
                onChange={(ev) => setTipoMensaje(ev.target.value as typeof tipoMensaje)}
              >
                {opciones.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.texto}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Texto">
            {(fid) => (
              <textarea
                id={fid}
                required
                maxLength={4000}
                rows={3}
                className={`${claseEntrada} py-2`}
                value={texto}
                onChange={(ev) => setTexto(ev.target.value)}
              />
            )}
          </Campo>
          <div>
            <Boton type="submit" ocupado={mensaje.isPending} disabled={texto.trim() === ''}>
              Enviar
            </Boton>
          </div>
        </form>
      )}

      {a.permisos.puede_cerrar || a.permisos.puede_reabrir ? (
        <div className="mt-6 flex flex-col gap-3 border-t border-linea pt-4">
          <Campo
            etiqueta={a.permisos.puede_reabrir ? 'Motivo de la reapertura' : 'Comentario de cierre'}
            ayuda={a.permisos.puede_reabrir ? 'Obligatorio.' : 'Opcional.'}
          >
            {(fid) => (
              <textarea
                id={fid}
                maxLength={2000}
                rows={2}
                className={`${claseEntrada} py-2`}
                value={comentario}
                onChange={(ev) => setComentario(ev.target.value)}
              />
            )}
          </Campo>
          <div className="flex flex-wrap gap-2">
            {a.permisos.puede_cerrar ? (
              <Boton ocupado={cerrar.isPending} onClick={() => cerrar.mutate()}>
                Cerrar alerta
              </Boton>
            ) : null}
            {a.permisos.puede_reabrir ? (
              <Boton
                variante="atencion"
                ocupado={reabrir.isPending}
                disabled={comentario.trim() === ''}
                onClick={() => reabrir.mutate()}
              >
                Reabrir alerta
              </Boton>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
};

const Dato = ({ termino, valor }: { termino: string; valor: string | null }) => (
  <div>
    <dt className="text-tinta-suave">{termino}</dt>
    <dd className="font-medium">{valor ?? '—'}</dd>
  </div>
);

// ── Registro desde la web (Coordinación y JdP) ──

const NuevaAlerta = ({ brigadas }: { brigadas: Brigada[] }) => {
  const proyectoId = useProyectoId();
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<'tecnica' | 'logistica'>('tecnica');
  const [cat, setCat] = useState<CategoriaAlertaLogistica>('movilidad');
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [brigada, setBrigada] = useState('');
  const [estacion, setEstacion] = useState('');
  const [afecta, setAfecta] = useState(false);
  const estaciones = useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
    enabled: abierto,
  });
  const guardar = useMutation({
    mutationFn: () =>
      api.post(`/proyectos/${proyectoId}/alertas`, {
        tipo,
        categoria: tipo === 'logistica' ? cat : null,
        titulo,
        descripcion: descripcion.trim() === '' ? null : descripcion,
        brigada_id: brigada === '' ? null : brigada,
        estacion_id: estacion === '' ? null : estacion,
        afecta_cronograma: afecta,
      }),
    onSuccess: async () => {
      setAbierto(false);
      setTitulo('');
      setDescripcion('');
      await qc.invalidateQueries({ queryKey: ['alertas', proyectoId] });
    },
  });
  return (
    <>
      <Boton onClick={() => setAbierto(true)}>Registrar alerta</Boton>
      <Dialogo abierto={abierto} titulo="Registrar alerta" alCerrar={() => setAbierto(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            guardar.mutate();
          }}
        >
          <Campo etiqueta="Tipo">
            {(id) => (
              <select
                id={id}
                className={claseEntrada}
                value={tipo}
                onChange={(ev) => setTipo(ev.target.value as 'tecnica' | 'logistica')}
              >
                <option value="tecnica">Técnica / metodológica</option>
                <option value="logistica">Logística</option>
              </select>
            )}
          </Campo>
          {tipo === 'logistica' ? (
            <Campo etiqueta="Categoría">
              {(id) => (
                <select
                  id={id}
                  className={claseEntrada}
                  value={cat}
                  onChange={(ev) => setCat(ev.target.value as CategoriaAlertaLogistica)}
                >
                  {CATEGORIAS_ALERTA_LOGISTICA.map((c) => (
                    <option key={c} value={c}>
                      {ETIQUETA_CATEGORIA_LOGISTICA[c]}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
          ) : null}
          <Campo etiqueta="Título">
            {(id) => (
              <input
                id={id}
                required
                maxLength={200}
                className={claseEntrada}
                value={titulo}
                onChange={(ev) => setTitulo(ev.target.value)}
              />
            )}
          </Campo>
          <Campo etiqueta="Descripción" ayuda="Opcional.">
            {(id) => (
              <textarea
                id={id}
                maxLength={4000}
                rows={3}
                className={`${claseEntrada} py-2`}
                value={descripcion}
                onChange={(ev) => setDescripcion(ev.target.value)}
              />
            )}
          </Campo>
          <Campo etiqueta="Brigada" ayuda="Opcional.">
            {(id) => (
              <select
                id={id}
                className={claseEntrada}
                value={brigada}
                onChange={(ev) => setBrigada(ev.target.value)}
              >
                <option value="">Sin brigada</option>
                {brigadas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Estación" ayuda="Opcional.">
            {(id) => (
              <select
                id={id}
                className={claseEntrada}
                value={estacion}
                onChange={(ev) => setEstacion(ev.target.value)}
              >
                <option value="">Sin estación</option>
                {(estaciones.data?.estaciones ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.codigo}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-5"
              checked={afecta}
              onChange={(ev) => setAfecta(ev.target.checked)}
            />
            Afecta el cronograma
          </label>
          <AvisoError error={guardar.error} />
          <div>
            <Boton type="submit" ocupado={guardar.isPending} disabled={titulo.trim() === ''}>
              Registrar
            </Boton>
          </div>
        </form>
      </Dialogo>
    </>
  );
};
