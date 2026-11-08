import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  api,
  type Brigada,
  type CambioCronograma,
  type Cronograma as C,
  type EstadoFilaCronograma,
  type EstadoSolicitudCronograma,
  type ItemCronograma,
  type SolicitudCronograma,
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
import { useYo } from '../sesion.ts';
import { ACTIVIDAD, AsignarEstacion, BorradorBase } from './CronogramaArmado.tsx';
import { useProyectoId } from './Proyectos.tsx';

/** Estado de la fila con texto e ícono: el color nunca es el único indicador. */
const ESTADO_FILA: Readonly<
  Record<EstadoFilaCronograma, { texto: string; icono: string; clase: string }>
> = {
  ok: { texto: 'Programada', icono: '●', clase: 'text-liquen-oscuro' },
  pendiente_validacion: { texto: 'Pendiente de validación', icono: '?', clase: 'text-ocre' },
  reprogramada: { texto: 'Reprogramada', icono: '↻', clase: 'text-ocre' },
  sujeta_a_decision: { texto: 'Sujeta a decisión', icono: '⚑', clase: 'text-oxido' },
};

const ESTADO_SOLICITUD: Readonly<
  Record<EstadoSolicitudCronograma, { texto: string; clase: string }>
> = {
  pendiente: { texto: 'Pendiente de aprobación', clase: 'border-ocre bg-ocre-claro' },
  ajuste_solicitado: { texto: 'Ajuste solicitado', clase: 'border-ocre bg-ocre-claro' },
  aprobada: { texto: 'Aprobada', clase: 'border-liquen bg-liquen-claro' },
  rechazada: { texto: 'Rechazada', clase: 'border-oxido bg-oxido-claro' },
};

const fechaCorta = (iso: string | null): string => {
  if (iso === null) return '—';
  const [a, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(a ?? 2000, (m ?? 1) - 1, d ?? 1));
};

const actividad = (i: ItemCronograma): string =>
  i.tipo_actividad === 'estacion'
    ? `${i.estacion_codigo ?? 'Estación'}${i.actividad_especial === null ? '' : ` · ${i.actividad_especial}`}`
    : `${ACTIVIDAD[i.tipo_actividad] ?? i.tipo_actividad}${i.detalle === null ? '' : `: ${i.detalle}`}`;

const EstadoFila = ({ estado }: { estado: EstadoFilaCronograma }) => {
  const e = ESTADO_FILA[estado];
  return (
    <span className={`whitespace-nowrap ${e.clase}`}>
      <span aria-hidden="true">{e.icono} </span>
      {e.texto}
    </span>
  );
};

// ── Propuesta de Coordinación ──

const Propuesta = ({
  proyectoId,
  items,
  brigadas,
  ajustables,
  aplicaAhora,
  alTerminar,
}: {
  proyectoId: string;
  items: ItemCronograma[];
  brigadas: Brigada[];
  ajustables: SolicitudCronograma[];
  /** El Jefe de Proyecto puede aprobar en el mismo paso (RN-36). */
  aplicaAhora: boolean;
  alTerminar: () => void;
}) => {
  const qc = useQueryClient();
  const [accion, setAccion] = useState<'reprogramar' | 'sujeta_a_decision'>('reprogramar');
  const [fecha, setFecha] = useState('');
  const [brigada, setBrigada] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ajustar, setAjustar] = useState('');
  const enviar = useMutation({
    mutationFn: (ahora: boolean) => {
      // Sin fecha nueva: cada fila conserva la suya (solo cambia de brigada).
      const cambios: CambioCronograma[] = items.map((i) =>
        accion === 'reprogramar'
          ? {
              tipo: 'reprogramar',
              item_id: i.id,
              fecha: fecha === '' ? i.fecha : fecha,
              brigada_id: brigada === '' ? null : brigada,
            }
          : { tipo: 'marcar', item_id: i.id, estado_fila: 'sujeta_a_decision' },
      );
      if (ahora) {
        return api.post(`/proyectos/${proyectoId}/cronograma/aplicar`, { motivo, cambios });
      }
      return ajustar === ''
        ? api.post(`/proyectos/${proyectoId}/cronograma/solicitudes`, { motivo, cambios })
        : api.post(`/cronograma/solicitudes/${ajustar}/ajustar`, { motivo, cambios });
    },
    onSuccess: async () => {
      setMotivo('');
      setFecha('');
      alTerminar();
      await qc.invalidateQueries();
    },
  });
  const sinCambio = accion === 'reprogramar' && fecha === '' && brigada === '';

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-linea bg-hoja p-4"
      aria-labelledby="titulo-propuesta"
      onSubmit={(e) => {
        e.preventDefault();
        enviar.mutate(false);
      }}
    >
      <h2 id="titulo-propuesta" className="text-lg font-semibold">
        Mover o cambiar de brigada
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-tinta-suave">
          Marque en la tabla las filas del cronograma vigente que cambian.
        </p>
      ) : (
        <p className="text-sm">
          {items.length === 1 ? 'Fila elegida: ' : `${String(items.length)} filas elegidas: `}
          <strong>{items.map((i) => `${actividad(i)} (${i.fecha})`).join('; ')}</strong>
        </p>
      )}
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-semibold">Cambio</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="accion"
            checked={accion === 'reprogramar'}
            onChange={() => setAccion('reprogramar')}
            className="size-5 accent-liquen"
          />
          Mover de fecha o de brigada
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="accion"
            checked={accion === 'sujeta_a_decision'}
            onChange={() => setAccion('sujeta_a_decision')}
            className="size-5 accent-liquen"
          />
          Dejar sujeta a decisión
        </label>
      </fieldset>
      {accion === 'reprogramar' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nueva fecha" ayuda="Déjela vacía si solo cambia de brigada.">
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
          <Campo etiqueta="Brigada" ayuda="Déjela igual si no cambia de brigada.">
            {(id) => (
              <select
                id={id}
                value={brigada}
                onChange={(e) => setBrigada(e.target.value)}
                className={claseEntrada}
              >
                <option value="">La misma brigada</option>
                {brigadas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.codigo ?? b.nombre}
                  </option>
                ))}
              </select>
            )}
          </Campo>
        </div>
      ) : null}
      <Campo
        etiqueta="Motivo"
        ayuda="Desviación registrada en campo o identificada por Coordinación."
      >
        {(id) => (
          <textarea
            id={id}
            required
            maxLength={2000}
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={`${claseEntrada} py-2`}
          />
        )}
      </Campo>
      {ajustables.length > 0 ? (
        <Campo etiqueta="¿Responde a un pedido de ajuste del Jefe de Proyecto?">
          {(id) => (
            <select
              id={id}
              value={ajustar}
              onChange={(e) => setAjustar(e.target.value)}
              className={claseEntrada}
            >
              <option value="">No: es una propuesta nueva</option>
              {ajustables.map((s) => (
                <option key={s.id} value={s.id}>
                  Ajustar: {s.motivo.slice(0, 60)}
                </option>
              ))}
            </select>
          )}
        </Campo>
      ) : null}
      <AvisoError error={enviar.error} />
      <div className="flex flex-wrap gap-2">
        <Boton
          type="submit"
          variante={aplicaAhora ? 'secundario' : 'principal'}
          ocupado={enviar.isPending}
          disabled={items.length === 0 || sinCambio}
        >
          {ajustar === '' ? 'Enviar como solicitud' : 'Reenviar ajustada'}
        </Boton>
        {aplicaAhora && ajustar === '' ? (
          <Boton
            ocupado={enviar.isPending}
            disabled={items.length === 0 || sinCambio || motivo.trim() === ''}
            onClick={() => enviar.mutate(true)}
          >
            Aplicar ahora (crea la versión vigente)
          </Boton>
        ) : null}
      </div>
    </form>
  );
};

// ── Solicitudes con impacto y decisión del JdP ──

const Decision = ({
  solicitud,
  accion,
}: {
  solicitud: SolicitudCronograma;
  accion: 'rechazar' | 'pedir-ajuste';
}) => {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [comentario, setComentario] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/cronograma/solicitudes/${solicitud.id}/${accion}`, { comentario }),
    onSuccess: async () => {
      setAbierto(false);
      await qc.invalidateQueries({ queryKey: ['solicitudes'] });
    },
  });
  const titulo = accion === 'rechazar' ? 'Rechazar la propuesta' : 'Pedir un ajuste';
  return (
    <>
      <Boton
        variante={accion === 'rechazar' ? 'peligro' : 'secundario'}
        onClick={() => setAbierto(true)}
      >
        {accion === 'rechazar' ? 'Rechazar' : 'Pedir ajuste'}
      </Boton>
      <Dialogo abierto={abierto} titulo={titulo} alCerrar={() => setAbierto(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Campo etiqueta="Comentario para Coordinación">
            {(id) => (
              <textarea
                id={id}
                required
                rows={3}
                maxLength={2000}
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                className={`${claseEntrada} py-2`}
              />
            )}
          </Campo>
          <AvisoError error={m.error} />
          <div className="flex justify-end gap-2">
            <Boton variante="secundario" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" ocupado={m.isPending}>
              {titulo}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </>
  );
};

const Solicitud = ({ s, aprobar }: { s: SolicitudCronograma; aprobar: boolean }) => {
  const qc = useQueryClient();
  const aprobacion = useMutation({
    mutationFn: () => api.post(`/cronograma/solicitudes/${s.id}/aprobar`),
    onSuccess: () => qc.invalidateQueries(),
  });
  const e = ESTADO_SOLICITUD[s.estado];
  return (
    <li className="flex flex-col gap-3 rounded-md border border-linea bg-hoja p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${e.clase}`}>
          {e.texto}
        </span>
        <span className="text-xs text-tinta-suave">
          Propuesta por {s.propuesto_por_nombre} el {fechaHora(s.creado_en)} sobre la versión{' '}
          {s.version_base_numero}
          {s.version_resultante_numero === null
            ? ''
            : ` · generó la versión ${String(s.version_resultante_numero)}`}
        </span>
      </div>
      <p className="text-sm">{s.motivo}</p>
      <ul className="list-inside list-disc text-sm">
        {s.cambios.map((c, i) => (
          <li key={i}>
            <strong>{c.estacion_codigo ?? c.detalle ?? 'Actividad'}</strong>:{' '}
            {c.tipo === 'reprogramar'
              ? `de ${fechaCorta(c.fecha_antes)} (${c.brigada_antes ?? '—'}) a ${fechaCorta(c.fecha_despues)} (${c.brigada_despues ?? '—'})`
              : c.tipo === 'marcar'
                ? `queda «${ESTADO_FILA[c.estado_fila].texto.toLowerCase()}»`
                : `se agrega el ${fechaCorta(c.fecha_despues)} (${c.brigada_despues ?? '—'})`}
          </li>
        ))}
      </ul>
      {s.impacto === null ? null : (
        <p className="text-sm text-tinta-suave">
          Impacto:{' '}
          {s.impacto.estaciones_afectadas_codigos.length === 0
            ? 'no cambia la fecha ni la brigada de ninguna estación'
            : `estaciones ${s.impacto.estaciones_afectadas_codigos.join(', ')}`}
          {s.impacto.fechas_afectadas.length === 0
            ? ''
            : `; fechas ${s.impacto.fechas_afectadas.map(fechaCorta).join(', ')}`}
          . Ninguna estación desaparece del cronograma.
        </p>
      )}
      {s.comentario_decision === null ? null : (
        <p className="text-sm">
          <strong>
            Jefe de Proyecto{s.decidido_por_nombre === null ? '' : ` (${s.decidido_por_nombre})`}:
          </strong>{' '}
          {s.comentario_decision}
        </p>
      )}
      {aprobar && s.estado === 'pendiente' ? (
        <div className="flex flex-wrap gap-2">
          <Boton ocupado={aprobacion.isPending} onClick={() => aprobacion.mutate()}>
            Aprobar y crear versión vigente
          </Boton>
          <Decision solicitud={s} accion="pedir-ajuste" />
          <Decision solicitud={s} accion="rechazar" />
        </div>
      ) : s.estado === 'pendiente' ? (
        <p className="text-sm text-tinta-suave">
          Espera la decisión del Jefe de Proyecto: solo ese rol aprueba, pide ajuste o rechaza (RN-36).
          Ingrese con un usuario de rol global «Jefe de Proyecto» para decidir.
        </p>
      ) : null}
      <AvisoError error={aprobacion.error} />
    </li>
  );
};

// ── Página ──

/** Cronograma base y vigente, propuestas y aprobación (D02 §10, RF-W12, E-08). */
export const Cronograma = () => {
  const proyectoId = useProyectoId();
  const yo = useYo();
  const gestion = yo.data?.rol_global === 'coordinacion' || yo.data?.rol_global === 'jefe_proyecto';
  const aprueba = yo.data?.rol_global === 'jefe_proyecto';
  const [version, setVersion] = useState<number | null>(null);
  const [brigada, setBrigada] = useState('');
  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(new Set());

  const q = useQuery({
    queryKey: ['cronograma', proyectoId, version],
    queryFn: () =>
      api.get<C>(
        `/proyectos/${proyectoId}/cronograma${version === null ? '' : `?version=${String(version)}`}`,
      ),
  });
  const brigadas = useQuery({
    queryKey: ['brigadas', proyectoId],
    queryFn: () => api.get<{ brigadas: Brigada[] }>(`/proyectos/${proyectoId}/brigadas`),
  });
  const solicitudes = useQuery({
    queryKey: ['solicitudes', proyectoId],
    queryFn: () =>
      api.get<{ solicitudes: SolicitudCronograma[] }>(
        `/proyectos/${proyectoId}/cronograma/solicitudes`,
      ),
    enabled: gestion,
  });

  const v = q.data?.version ?? null;
  const versiones = q.data?.versiones ?? [];
  const todos = q.data?.items ?? [];
  const esVigente = v?.estado === 'vigente';
  const items = todos.filter((i) => brigada === '' || i.brigada_id === brigada);
  const nombreBrigada = new Map(
    (brigadas.data?.brigadas ?? []).map((b) => [b.id, b.codigo ?? b.nombre]),
  );
  const proponer = gestion && esVigente;
  const alternar = (id: string) =>
    setElegidos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <Encabezado titulo="Cronograma">
        {proponer ? (
          <AsignarEstacion
            proyectoId={proyectoId}
            items={todos}
            brigadas={brigadas.data?.brigadas ?? []}
            aplicaAhora={aprueba}
          />
        ) : null}
      </Encabezado>
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        El cronograma base (A01) se conserva sin cambios. Cada reprogramación que aprueba el Jefe de
        Proyecto crea una versión vigente nueva, que los celulares reciben al volver a descargar su
        paquete de campo. Una estación no ejecutada nunca desaparece: queda reprogramada o sujeta a
        decisión.
      </p>
      {q.isPending ? <Cargando que="el cronograma" /> : null}
      <AvisoError error={q.error} />
      {q.data !== undefined && q.data.version === null ? (
        gestion ? (
          <BorradorBase proyectoId={proyectoId} brigadas={brigadas.data?.brigadas ?? []} />
        ) : (
          <Vacio titulo="Este proyecto aún no tiene cronograma">
            El cronograma base llega con la carga de A01 o lo arma Coordinación desde la web.
          </Vacio>
        )
      ) : null}

      {q.data?.version != null ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <Campo etiqueta="Versión">
              {(id) => (
                <select
                  id={id}
                  value={v?.numero ?? ''}
                  onChange={(e) => {
                    setElegidos(new Set());
                    setVersion(Number(e.target.value));
                  }}
                  className={claseEntrada}
                >
                  {versiones.map((x) => (
                    <option key={x.id} value={x.numero}>
                      Versión {x.numero}
                      {x.es_base ? ' (base)' : ''}
                      {x.estado === 'vigente' ? ' · vigente' : ''}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
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
          </div>
          <p className="text-sm" role="status">
            {v?.es_base === true ? 'Cronograma base' : `Versión ${String(v?.numero)}`}
            {esVigente ? ' (vigente)' : ' (histórica, solo consulta)'}
            {v?.aprobado_en == null || v.es_base
              ? ''
              : `, aprobada el ${fechaHora(v.aprobado_en)}${v.aprobado_por_nombre === null ? '' : ` por ${v.aprobado_por_nombre}`}`}
            .
          </p>

          {items.length === 0 ? (
            <Vacio titulo="No hay actividades a su alcance en esta versión" />
          ) : (
            <Tabla titulo="Actividades del cronograma">
              <thead>
                <tr>
                  {proponer ? (
                    <th className={th}>
                      <span className="sr-only">Elegir para la propuesta</span>
                    </th>
                  ) : null}
                  <th className={th}>Fecha</th>
                  <th className={th}>Brigada</th>
                  <th className={th}>Actividad</th>
                  <th className={th}>Estado</th>
                  {v?.es_base === true ? null : <th className={th}>En el base</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const cambio = i.agregada
                    ? 'Agregada'
                    : i.base_fecha !== i.fecha || i.base_brigada_id !== i.brigada_id
                      ? `${fechaCorta(i.base_fecha)} · ${nombreBrigada.get(i.base_brigada_id ?? '') ?? '—'}`
                      : 'Sin cambio';
                  return (
                    <tr key={i.id} className={elegidos.has(i.id) ? 'bg-liquen-claro' : ''}>
                      {proponer ? (
                        <td className={td}>
                          <input
                            type="checkbox"
                            checked={elegidos.has(i.id)}
                            onChange={() => alternar(i.id)}
                            aria-label={`Elegir ${actividad(i)} del ${i.fecha}`}
                            className="size-5 accent-liquen"
                          />
                        </td>
                      ) : null}
                      <td className={`${td} cifras whitespace-nowrap`}>{fechaCorta(i.fecha)}</td>
                      <td className={td}>{i.brigada_codigo ?? i.brigada_nombre}</td>
                      <td
                        className={`${td} ${i.tipo_actividad === 'estacion' ? 'font-semibold' : ''}`}
                      >
                        {actividad(i)}
                      </td>
                      <td className={td}>
                        <EstadoFila estado={i.estado_fila} />
                      </td>
                      {v?.es_base === true ? null : (
                        <td
                          className={`${td} ${cambio === 'Sin cambio' ? 'text-tinta-suave' : ''}`}
                        >
                          {cambio}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Tabla>
          )}

          {proponer ? (
            <Propuesta
              proyectoId={proyectoId}
              items={todos.filter((i) => elegidos.has(i.id))}
              brigadas={brigadas.data?.brigadas ?? []}
              ajustables={(solicitudes.data?.solicitudes ?? []).filter(
                (s) => s.estado === 'ajuste_solicitado',
              )}
              aplicaAhora={aprueba}
              alTerminar={() => setElegidos(new Set())}
            />
          ) : null}
        </div>
      ) : null}

      {gestion ? (
        <section className="mt-8" aria-labelledby="titulo-solicitudes">
          <h2 id="titulo-solicitudes" className="mb-3 text-lg font-semibold">
            Solicitudes de reprogramación
          </h2>
          {solicitudes.isPending ? <Cargando que="las solicitudes" /> : null}
          <AvisoError error={solicitudes.error} />
          {solicitudes.data?.solicitudes.length === 0 ? (
            <Vacio titulo="Aún no hay solicitudes de reprogramación" />
          ) : null}
          <ul className="flex flex-col gap-3">
            {solicitudes.data?.solicitudes.map((s) => (
              <Solicitud key={s.id} s={s} aprobar={aprueba} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
};
