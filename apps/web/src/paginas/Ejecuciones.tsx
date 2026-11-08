import { ETIQUETAS_REGLA, ETIQUETAS_TIPO_CONTROL } from '@campo/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  api,
  ErrorApi,
  type Brigada,
  type EjecucionDetalle as Detalle,
  type EjecucionFila,
  type EstadoEjecucion,
  type Estacion,
  type ResultadoReglaQa,
} from '../api.ts';
import { Mapa, type CapaMapa } from '../componentes/MapaDiferido.tsx';
import {
  AvisoError,
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
import { useProyectoId } from './Proyectos.tsx';

/**
 * Ejecuciones en la web (D02 §11 Mapa/GIS, E-02, E-04, E-05): lista con filtros y detalle con
 * mapa, unidades, fotos y el resultado de la validación post-sincronización. Lo que se ve depende
 * del alcance que aplica la API: Coordinación y JdP todo, JdB y Supervisor de campo su brigada y
 * el especialista solo lo suyo.
 */

const ETIQUETA_ESTADO: Readonly<Record<EstadoEjecucion, string>> = {
  en_curso: 'En curso',
  evidencia_pendiente: 'Esperando evidencias',
  completa: 'Completa',
  parcial: 'Parcial',
  validada: 'Validada',
  observada: 'Observada',
};

/** El color acompaña al texto; nunca es el único indicador. */
const ESTILO_ESTADO: Readonly<Record<EstadoEjecucion, string>> = {
  en_curso: 'border-linea bg-hoja text-tinta',
  evidencia_pendiente: 'border-linea bg-papel text-tinta-suave',
  completa: 'border-liquen bg-liquen-claro text-liquen-oscuro',
  parcial: 'border-oxido bg-oxido-claro text-oxido',
  validada: 'border-liquen bg-liquen-claro text-liquen-oscuro',
  observada: 'border-ocre bg-ocre-claro text-tinta',
};

const ETIQUETA_DESVIACION: Readonly<Record<EjecucionFila['desviacion_tipo'], string>> = {
  ninguna: 'Ninguna',
  parcial: 'Ejecución parcial',
  imposibilidad: 'Imposibilidad',
  excepcional: 'Excepcional',
};

const ETIQUETA_FOTO: Readonly<Record<string, string>> = {
  contexto: 'Contexto',
  metodologica: 'Metodológica',
  primer_plano: 'Primer plano',
  cientifica: 'Científica',
};

const ESTADOS = Object.keys(ETIQUETA_ESTADO) as EstadoEjecucion[];

const EstadoEtiqueta = ({ estado }: { estado: EstadoEjecucion }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${ESTILO_ESTADO[estado]}`}
  >
    {ETIQUETA_ESTADO[estado]}
  </span>
);

const textoQa = (f: EjecucionFila): string => {
  if (f.incumplimientos_obligatorios === null) {
    return f.estado === 'en_curso' ? '—' : 'Pendiente de evaluación';
  }
  const partes = [
    f.incumplimientos_obligatorios === 0
      ? 'Sin incumplimientos obligatorios'
      : `${String(f.incumplimientos_obligatorios)} obligatorio(s) incumplido(s)`,
  ];
  if ((f.advertencias ?? 0) > 0) partes.push(`${String(f.advertencias)} advertencia(s)`);
  return partes.join(' · ');
};

// ── Lista ──

export const Ejecuciones = () => {
  const proyectoId = useProyectoId();
  const [brigada, setBrigada] = useState('');
  const [estacion, setEstacion] = useState('');
  const [estado, setEstado] = useState('');

  const brigadas = useQuery({
    queryKey: ['brigadas', proyectoId],
    queryFn: () => api.get<{ brigadas: Brigada[] }>(`/proyectos/${proyectoId}/brigadas`),
  });
  const estaciones = useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
  });
  const consulta = new URLSearchParams({
    ...(brigada === '' ? {} : { brigada }),
    ...(estacion === '' ? {} : { estacion }),
    ...(estado === '' ? {} : { estado }),
  }).toString();
  const q = useQuery({
    queryKey: ['ejecuciones', proyectoId, consulta],
    queryFn: () =>
      api.get<{ ejecuciones: EjecucionFila[] }>(
        `/proyectos/${proyectoId}/ejecuciones${consulta === '' ? '' : `?${consulta}`}`,
      ),
  });
  const lista = q.data?.ejecuciones ?? [];
  const filtrado = consulta !== '';

  return (
    <>
      <Encabezado titulo="Ejecuciones" />
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Cada método ejecutado en una estación, con su resultado frente a D01. «Parcial» indica que
        falta al menos un requisito obligatorio; las advertencias no la hacen parcial. Lo que aún no
        se sincroniza no cuenta como incumplimiento.
      </p>
      <form
        className="mb-5 grid gap-3 sm:grid-cols-3"
        onSubmit={(ev) => {
          ev.preventDefault();
        }}
        aria-label="Filtros de ejecuciones"
      >
        <Campo etiqueta="Brigada">
          {(id) => (
            <select
              id={id}
              className={claseEntrada}
              value={brigada}
              onChange={(ev) => {
                setBrigada(ev.target.value);
              }}
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
        <Campo etiqueta="Estación">
          {(id) => (
            <select
              id={id}
              className={claseEntrada}
              value={estacion}
              onChange={(ev) => {
                setEstacion(ev.target.value);
              }}
            >
              <option value="">Todas</option>
              {(estaciones.data?.estaciones ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Estado">
          {(id) => (
            <select
              id={id}
              className={claseEntrada}
              value={estado}
              onChange={(ev) => {
                setEstado(ev.target.value);
              }}
            >
              <option value="">Todos</option>
              {ESTADOS.map((x) => (
                <option key={x} value={x}>
                  {ETIQUETA_ESTADO[x]}
                </option>
              ))}
            </select>
          )}
        </Campo>
      </form>

      {q.isPending ? <Cargando que="las ejecuciones" /> : null}
      <AvisoError error={q.error} />
      {q.data !== undefined && lista.length === 0 ? (
        <Vacio
          titulo={
            filtrado ? 'Ninguna ejecución coincide con los filtros' : 'Aún no hay ejecuciones'
          }
        >
          {filtrado
            ? 'Cambie o quite los filtros para ver más resultados.'
            : 'Aparecen aquí cuando los celulares de campo sincronizan sus ejecuciones.'}
        </Vacio>
      ) : null}
      {lista.length > 0 ? (
        <Tabla titulo="Ejecuciones">
          <thead>
            <tr>
              <th className={th}>Estación y método</th>
              <th className={th}>Responsable</th>
              <th className={th}>Estado</th>
              <th className={th}>Validación D01</th>
              <th className={th}>Unidades</th>
              <th className={th}>Desviación</th>
              <th className={th}>Abierta / cerrada</th>
              <th className={th}>Última recepción</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id}>
                <td className={td}>
                  <Link
                    to="/p/$proyectoId/ejecuciones/$ejecucionId"
                    params={{ proyectoId, ejecucionId: f.id }}
                    className="font-semibold text-liquen underline-offset-4 hover:underline"
                  >
                    {f.estacion_codigo} · {f.metodo_nombre}
                  </Link>
                  <p className="text-xs text-tinta-suave">{f.especialidad_nombre}</p>
                </td>
                <td className={td}>
                  {f.usuario_nombre}
                  <p className="text-xs text-tinta-suave">{f.brigada_nombre ?? 'Sin brigada'}</p>
                </td>
                <td className={td}>
                  <EstadoEtiqueta estado={f.estado} />
                </td>
                <td
                  className={`${td} ${(f.incumplimientos_obligatorios ?? 0) > 0 ? 'font-semibold text-oxido' : ''}`}
                >
                  {textoQa(f)}
                </td>
                <td className={`${td} cifras`}>{f.unidades}</td>
                <td className={td}>
                  {ETIQUETA_DESVIACION[f.desviacion_tipo]}
                  {f.desviacion_explicacion === null ? null : (
                    <p className="text-xs text-tinta-suave">{f.desviacion_explicacion}</p>
                  )}
                </td>
                <td className={`${td} cifras whitespace-nowrap`}>
                  {fechaHora(f.abierta_en)}
                  <br />
                  {f.cerrada_en === null ? 'Sin cerrar' : fechaHora(f.cerrada_en)}
                </td>
                <td className={`${td} cifras whitespace-nowrap`}>
                  {f.ultima_recepcion === null ? 'Sin datos' : fechaHora(f.ultima_recepcion)}
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}
    </>
  );
};

// ── Detalle ──

const Miniatura = ({ archivoId, texto }: { archivoId: string; texto: string }) => {
  const q = useQuery({
    queryKey: ['archivo-url', archivoId, 'miniatura'],
    queryFn: () => api.get<{ url: string }>(`/archivos/${archivoId}/url?variante=miniatura`),
    // Las URLs firmadas duran ≤ 15 min (CLAUDE.md, Seguridad).
    staleTime: 10 * 60_000,
    retry: false,
  });
  const previa = useQuery({
    queryKey: ['archivo-url', archivoId, 'preview'],
    queryFn: () => api.get<{ url: string }>(`/archivos/${archivoId}/url?variante=preview`),
    staleTime: 10 * 60_000,
    enabled: false,
  });
  if (q.isPending) {
    return (
      <div className="flex aspect-square items-center justify-center bg-papel text-xs text-tinta-suave">
        Cargando…
      </div>
    );
  }
  if (q.data === undefined) {
    const pendiente = q.error instanceof ErrorApi && q.error.estado === 404;
    return (
      <div className="flex aspect-square items-center justify-center bg-papel p-2 text-center text-xs text-tinta-suave">
        {pendiente ? 'Foto aún no verificada en el servidor' : 'No se pudo cargar la foto'}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="block w-full"
      onClick={() => {
        void previa.refetch().then((r) => {
          if (r.data !== undefined) window.open(r.data.url, '_blank', 'noopener');
        });
      }}
      aria-label={`Abrir la foto en tamaño completo: ${texto}`}
    >
      <img
        src={q.data.url}
        alt={texto}
        className="aspect-square w-full object-cover"
        loading="lazy"
      />
    </button>
  );
};

const ORDEN_CONTROL: readonly ResultadoReglaQa['tipo_control'][] = [
  'obligatorio',
  'advertencia',
  'informativo',
  'referencia',
  'criterio_humano',
];

const ETIQUETA_RESULTADO: Readonly<Record<ResultadoReglaQa['estado'], string>> = {
  cumple: 'Cumple',
  incumple: 'Incumple',
  no_aplica: 'No aplica',
  no_evaluable: 'Sin datos para evaluar',
  informativo: 'Informativo',
};

const ETIQUETAS: Readonly<Record<string, string>> = ETIQUETAS_REGLA;
const etiquetaRegla = (r: string): string => ETIQUETAS[r] ?? r;

const ResultadosQa = ({ detalle }: { detalle: Detalle }) => {
  const qa = detalle.resultado_qa;
  const codigoUnidad = new Map(detalle.unidades.map((u) => [u.id, u.codigo]));
  if (qa === null) {
    return (
      <Vacio titulo="Aún sin validación post-sincronización">
        {detalle.estado === 'en_curso'
          ? 'La ejecución sigue abierta en el celular.'
          : 'Se evalúa contra D01 cuando el servidor verifica todas sus fotos.'}
      </Vacio>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <strong>{qa.incumplimientos_obligatorios}</strong> incumplimiento(s) obligatorio(s) ·{' '}
        <strong>{qa.advertencias}</strong> advertencia(s)
        {detalle.qa_evaluado_en === null ? null : (
          <span className="text-tinta-suave"> · evaluado {fechaHora(detalle.qa_evaluado_en)}</span>
        )}
      </p>
      {ORDEN_CONTROL.map((control) => {
        const grupo = qa.resultados.filter((r) => r.tipo_control === control);
        if (grupo.length === 0) return null;
        return (
          <section key={control} aria-labelledby={`qa-${control}`}>
            <h3 id={`qa-${control}`} className="mb-2 font-semibold">
              {ETIQUETAS_TIPO_CONTROL[control]}
            </h3>
            <ul className="flex flex-col gap-2">
              {grupo.map((r, i) => {
                const grave = r.estado === 'incumple' && r.tipo_control === 'obligatorio';
                const aviso = r.estado === 'incumple' && r.tipo_control === 'advertencia';
                return (
                  <li
                    key={`${r.regla}-${r.unidad_id ?? ''}-${String(i)}`}
                    className={`rounded-md border px-3 py-2 text-sm ${grave ? 'border-oxido bg-oxido-claro' : aviso ? 'border-ocre bg-ocre-claro' : 'border-linea bg-hoja'}`}
                  >
                    <p>
                      <strong className={grave ? 'text-oxido' : ''}>
                        {grave ? 'Incumple (obligatorio)' : ETIQUETA_RESULTADO[r.estado]}
                      </strong>{' '}
                      · {etiquetaRegla(r.regla)}
                      {r.unidad_id === null
                        ? null
                        : ` · unidad ${codigoUnidad.get(r.unidad_id) ?? ''}`}
                    </p>
                    <p>{r.mensaje}</p>
                    <p className="text-xs text-tinta-suave">D01: {r.texto_d01}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
};

const valorDato = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
};

export const EjecucionDetalle = () => {
  const proyectoId = useProyectoId();
  const { ejecucionId } = useParams({ from: '/p/$proyectoId/ejecuciones/$ejecucionId' });
  const q = useQuery({
    queryKey: ['ejecucion', ejecucionId],
    queryFn: () => api.get<Detalle>(`/ejecuciones/${ejecucionId}`),
  });
  const d = q.data;

  const capas = useMemo((): CapaMapa[] => {
    if (d === undefined) return [];
    return [
      ...d.unidades.flatMap((u) =>
        u.geometria === null
          ? []
          : [{ id: u.id, tipo: 'unidad' as const, etiqueta: u.codigo, geometria: u.geometria }],
      ),
      ...d.tracks.flatMap((t) =>
        t.geometria === null
          ? []
          : [{ id: t.id, tipo: 'track' as const, etiqueta: 'Track', geometria: t.geometria }],
      ),
    ];
  }, [d]);
  const puntos = useMemo(
    () =>
      d === undefined
        ? []
        : [
            {
              id: d.estacion_id,
              lat: d.estacion_lat,
              lon: d.estacion_lon,
              titulo: d.estacion_codigo,
              zaEf: d.estacion_za_ef !== null && d.estacion_za_ef !== '',
            },
          ],
    [d],
  );

  return (
    <>
      <p className="mb-2 text-sm">
        <Link
          to="/p/$proyectoId/ejecuciones"
          params={{ proyectoId }}
          className="text-liquen underline-offset-4 hover:underline"
        >
          ← Ejecuciones
        </Link>
      </p>
      {q.isPending ? <Cargando que="la ejecución" /> : null}
      <AvisoError error={q.error} />
      {d === undefined ? null : (
        <div className="flex flex-col gap-8">
          <div>
            <Encabezado titulo={`${d.estacion_codigo} · ${d.metodo_nombre}`}>
              <EstadoEtiqueta estado={d.estado} />
            </Encabezado>
            <dl className="-mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-tinta-suave">Especialidad</dt>
                <dd>{d.especialidad_nombre}</dd>
              </div>
              <div>
                <dt className="text-tinta-suave">Responsable</dt>
                <dd>
                  {d.usuario_nombre} · {d.brigada_nombre ?? 'Sin brigada'}
                </dd>
              </div>
              <div>
                <dt className="text-tinta-suave">Abierta / cerrada</dt>
                <dd className="cifras">
                  {fechaHora(d.abierta_en)} /{' '}
                  {d.cerrada_en === null ? 'Sin cerrar' : fechaHora(d.cerrada_en)}
                </dd>
              </div>
              <div>
                <dt className="text-tinta-suave">Desviación declarada</dt>
                <dd>
                  {ETIQUETA_DESVIACION[d.desviacion_tipo]}
                  {d.desviacion_explicacion === null ? '' : `: ${d.desviacion_explicacion}`}
                </dd>
              </div>
              <div>
                <dt className="text-tinta-suave">Última recepción</dt>
                <dd className="cifras">
                  {d.ultima_recepcion === null ? 'Sin datos' : fechaHora(d.ultima_recepcion)}
                </dd>
              </div>
              {d.objetivo_campo === null ? null : (
                <div>
                  <dt className="text-tinta-suave">Objetivo definido en campo</dt>
                  <dd className="cifras">{d.objetivo_campo}</dd>
                </div>
              )}
            </dl>
          </div>

          <section aria-labelledby="titulo-mapa">
            <h2 id="titulo-mapa" className="mb-2 text-lg font-semibold">
              Mapa
            </h2>
            <Mapa puntos={puntos} capas={capas} alto="26rem" etiqueta="Mapa de la ejecución" />
            <p className="mt-2 text-xs text-tinta-suave">
              Círculo verde: estación (anillo ocre si es ZA/EF). Ocre: geometría de las unidades.
              Línea discontinua: track del recorrido.
              {capas.length === 0 ? ' Esta ejecución aún no tiene geometrías recibidas.' : ''}
            </p>
          </section>

          <section aria-labelledby="titulo-qa">
            <h2 id="titulo-qa" className="mb-3 text-lg font-semibold">
              Validación contra D01
            </h2>
            <ResultadosQa detalle={d} />
          </section>

          <section aria-labelledby="titulo-unidades">
            <h2 id="titulo-unidades" className="mb-3 text-lg font-semibold">
              Unidades ({d.unidades.length})
            </h2>
            {d.unidades.length === 0 ? (
              <Vacio titulo="Sin unidades recibidas" />
            ) : (
              <Tabla titulo="Unidades">
                <thead>
                  <tr>
                    <th className={th}>Código</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Estado</th>
                    <th className={th}>Inicio / fin</th>
                    <th className={th}>Geometría</th>
                    <th className={th}>Datos</th>
                  </tr>
                </thead>
                <tbody>
                  {d.unidades.map((u) => (
                    <tr key={u.id}>
                      <td className={`${td} font-semibold`}>{u.codigo}</td>
                      <td className={td}>{u.tipo_unidad}</td>
                      <td className={td}>{u.estado === 'cerrada' ? 'Cerrada' : 'Abierta'}</td>
                      <td className={`${td} cifras whitespace-nowrap`}>
                        {fechaHora(u.inicio)}
                        <br />
                        {fechaHora(u.fin)}
                      </td>
                      <td className={td}>{u.geometria?.type ?? 'Sin geometría'}</td>
                      <td className={td}>
                        {Object.keys(u.datos).length === 0 ? (
                          '—'
                        ) : (
                          <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                            {Object.entries(u.datos).map(([k, v]) => (
                              <div key={k} className="contents">
                                <dt className="text-tinta-suave">{k.replaceAll('_', ' ')}</dt>
                                <dd>{valorDato(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {u.registros.length > 0 ? (
                          <p className="mt-1 text-xs text-tinta-suave">
                            {u.registros.length} registro(s)
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            )}
          </section>

          <section aria-labelledby="titulo-fotos">
            <h2 id="titulo-fotos" className="mb-3 text-lg font-semibold">
              Fotos ({d.fotos.length})
            </h2>
            {d.fotos.length === 0 ? (
              <Vacio titulo="Sin fotos recibidas" />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {d.fotos.map((f) => {
                  const unidad = d.unidades.find((u) => u.id === f.unidad_id)?.codigo;
                  const texto = [
                    ETIQUETA_FOTO[f.tipo_foto ?? ''] ?? 'Foto',
                    f.orientacion === null ? null : `orientación ${f.orientacion}`,
                    unidad === undefined ? 'de la ejecución' : `unidad ${unidad}`,
                  ]
                    .filter((x) => x !== null)
                    .join(' · ');
                  return (
                    <li
                      key={f.id}
                      className="overflow-hidden rounded-md border border-linea bg-hoja"
                    >
                      <Miniatura archivoId={f.id} texto={texto} />
                      <p className="px-2 py-1 text-xs">{texto}</p>
                      <p className="cifras px-2 pb-1 text-xs text-tinta-suave">
                        {fechaHora(f.capturado_en)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
};
