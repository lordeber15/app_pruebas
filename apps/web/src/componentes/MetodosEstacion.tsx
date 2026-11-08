import { decisionEstacionMetodoSchema, ETIQUETAS_TIPO_CONTROL } from '@campo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  api,
  ErrorApi,
  type ClaseMetodo,
  type EstadoMatriz,
  type MetodoDeEstacion,
  type MetodosDeEstacion,
} from '../api.ts';
import {
  AvisoError,
  Boton,
  Campo,
  Cargando,
  claseEntrada,
  Dialogo,
  fechaHora,
  Vacio,
} from './Ui.tsx';

/**
 * Panel «Métodos a ejecutar» de una estación (decisión del usuario 2026-11-08; RN-28, P-01).
 * Por especialidad: clase de D01, estado en la matriz (forma + ícono + texto, nunca solo color),
 * condición y resumen de D01 en solo lectura, reserva y ejecuciones. Coordinación y JdP confirman
 * o descartan los CONDICIONAL con un motivo obligatorio; la API vuelve a autorizar cada decisión.
 */

const CLASE: Readonly<Record<ClaseMetodo, string>> = {
  todas: 'Todas las estaciones',
  condicional: 'Condicional',
  evento: 'Evento (registro oportuno)',
  atributo: 'Atributo de otro método',
  transversal: 'ABS: toda estación de fauna',
};

const ESTADO: Readonly<
  Record<
    EstadoMatriz,
    {
      texto: string;
      icono: string;
      forma: 'circulo' | 'cuadrado' | 'rombo';
      fondo: string;
      tinta: string;
    }
  >
> = {
  aplicable: {
    texto: 'Aplicable',
    icono: '✓',
    forma: 'circulo',
    fondo: '#224639',
    tinta: '#ffffff',
  },
  condicion_pendiente: {
    texto: 'Condición pendiente',
    icono: '?',
    forma: 'cuadrado',
    fondo: '#7a4f12',
    tinta: '#ffffff',
  },
  no_aplica: {
    texto: 'No aplica (condición de D01)',
    icono: '–',
    forma: 'circulo',
    fondo: '#ffffff',
    tinta: '#18231f',
  },
  descartado: {
    texto: 'Descartado',
    icono: '✕',
    forma: 'rombo',
    fondo: '#9b2c1f',
    tinta: '#ffffff',
  },
  evento: {
    texto: 'Siempre disponible',
    icono: '+',
    forma: 'circulo',
    fondo: '#1d4f91',
    tinta: '#ffffff',
  },
  atributo: {
    texto: 'No es un método',
    icono: '·',
    forma: 'cuadrado',
    fondo: '#ffffff',
    tinta: '#18231f',
  },
};

const InsigniaMatriz = ({ estado }: { estado: EstadoMatriz }) => {
  const e = ESTADO[estado];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold">
      <span
        aria-hidden="true"
        className="inline-flex size-5 items-center justify-center text-xs font-bold"
        style={{
          background: e.fondo,
          color: e.tinta,
          borderRadius: e.forma === 'circulo' ? '9999px' : '3px',
          transform: e.forma === 'rombo' ? 'rotate(45deg) scale(0.85)' : undefined,
          boxShadow: '0 0 0 1px rgba(24,35,31,0.55)',
        }}
      >
        <span style={{ transform: e.forma === 'rombo' ? 'rotate(-45deg)' : undefined }}>
          {e.icono}
        </span>
      </span>
      {e.texto}
    </span>
  );
};

const textoReserva = (m: MetodoDeEstacion): string => {
  if (m.clase === 'evento') return 'Se registra sin reserva';
  if (m.clase === 'atributo') return 'Se registra dentro de su método';
  if (m.reserva === null) return 'Sin reserva';
  switch (m.reserva.estado) {
    case 'asignada':
      return 'Reserva con brigada y fecha';
    case 'pendiente':
      return 'Reserva sin brigada ni fecha aún';
    case 'descartada':
      return 'Reserva descartada (se conserva)';
    default:
      return `Reserva: ${m.reserva.estado}`;
  }
};

const textoOrigen = (m: MetodoDeEstacion): string | null => {
  if (m.decision !== null) {
    return `${m.decision.decision === 'confirmar' ? 'Confirmado' : 'Descartado'} por ${m.decision.por} el ${fechaHora(m.decision.en)}: «${m.decision.motivo}»`;
  }
  if (m.origen === 'nominal') return 'Decisión nominal de la programación (A01)';
  if (m.origen === 'condicion')
    return 'Derivado de la condición de D01 con los atributos de la estación';
  return null;
};

type Decision = 'confirmar' | 'descartar';

const DialogoDecision = ({
  estacionId,
  estacionCodigo,
  metodo,
  decision,
  alCerrar,
}: {
  estacionId: string;
  estacionCodigo: string;
  metodo: MetodoDeEstacion;
  decision: Decision;
  alCerrar: () => void;
}) => {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const guardar = useMutation({
    mutationFn: () => {
      // Mismo esquema que la API (core).
      const r = decisionEstacionMetodoSchema.safeParse({ decision, motivo });
      if (!r.success) {
        throw new ErrorApi(
          400,
          'DATOS_INVALIDOS',
          r.error.issues[0]?.message ?? 'Revise el motivo.',
        );
      }
      return api.post(`/estaciones/${estacionId}/metodos/${metodo.metodo_id}/decision`, r.data);
    },
    onSuccess: async () => {
      alCerrar();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['metodos-estacion', estacionId] }),
        qc.invalidateQueries({ queryKey: ['estaciones'] }),
        qc.invalidateQueries({ queryKey: ['avance-estaciones'] }),
      ]);
    },
  });
  const confirmar = decision === 'confirmar';
  return (
    <Dialogo
      abierto
      titulo={`${confirmar ? 'Confirmar' : 'Descartar'} ${metodo.nombre} en ${estacionCodigo}`}
      alCerrar={alCerrar}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          guardar.mutate();
        }}
      >
        <p className="text-sm">
          {confirmar
            ? 'El método pasará a ejecutarse en esta estación: se crea su reserva con la brigada y la fecha del cronograma vigente, y llega a los celulares al volver a descargar el paquete de campo.'
            : 'El método dejará de ejecutarse en esta estación. Su reserva no se borra: queda descartada y deja de llegar a los celulares.'}{' '}
          La decisión no cambia aunque luego se corrijan los atributos de la estación.
        </p>
        {metodo.condicion_d01 === '' ? null : (
          <p className="rounded-md border border-linea bg-papel px-3 py-2 text-sm">
            <strong className="font-semibold">Condición de D01: </strong>
            {metodo.condicion_d01}
          </p>
        )}
        <Campo
          etiqueta="Motivo (obligatorio)"
          ayuda="Entre 3 y 500 caracteres. Queda en el historial con su nombre y la fecha."
        >
          {(id) => (
            <textarea
              id={id}
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className={`${claseEntrada} py-2`}
            />
          )}
        </Campo>
        <AvisoError error={guardar.error} />
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton
            type="submit"
            variante={confirmar ? 'principal' : 'peligro'}
            ocupado={guardar.isPending}
          >
            {confirmar ? 'Confirmar método' : 'Descartar método'}
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
};

const Acciones = ({
  m,
  puedeDecidir,
  alDecidir,
}: {
  m: MetodoDeEstacion;
  puedeDecidir: boolean;
  alDecidir: (d: Decision) => void;
}) => {
  if (m.clase === 'todas' || (m.clase === 'transversal' && m.estado === 'aplicable')) {
    return (
      <p className="text-sm font-semibold text-liquen-oscuro">
        Obligatorio en esta estación (RN-28)
      </p>
    );
  }
  if (!m.admite_decision || !puedeDecidir) return null;
  const confirmable = m.estado !== 'aplicable';
  const descartable = m.estado !== 'descartado';
  const conEjecuciones = m.ejecuciones > 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirmable ? (
        <Boton onClick={() => alDecidir('confirmar')} aria-label={`Confirmar ${m.nombre}`}>
          Confirmar
        </Boton>
      ) : null}
      {descartable ? (
        <Boton
          variante="secundario"
          disabled={conEjecuciones}
          onClick={() => alDecidir('descartar')}
          aria-label={`Descartar ${m.nombre}`}
        >
          Descartar
        </Boton>
      ) : null}
      {descartable && conEjecuciones ? (
        <span className="text-xs text-tinta-suave">Tiene ejecuciones: no se puede descartar.</span>
      ) : null}
    </div>
  );
};

const FilaMetodo = ({
  m,
  puedeDecidir,
  alDecidir,
}: {
  m: MetodoDeEstacion;
  puedeDecidir: boolean;
  alDecidir: (d: Decision) => void;
}) => {
  const origen = textoOrigen(m);
  return (
    <li className="flex flex-col gap-2 border-b border-linea px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{m.nombre}</p>
          <p className="text-xs text-tinta-suave">
            {CLASE[m.clase]} · <span className="cifras">{m.codigo}</span>
          </p>
        </div>
        <InsigniaMatriz estado={m.estado} />
      </div>
      {m.clase === 'condicional' && m.condicion_d01 !== '' ? (
        <p className="text-sm">
          <span className="font-semibold">Condición de D01: </span>
          {m.condicion_d01}
        </p>
      ) : null}
      <p className="text-sm text-tinta-suave">
        {textoReserva(m)}
        {m.clase === 'atributo'
          ? ''
          : ` · ${String(m.ejecuciones)} ${m.ejecuciones === 1 ? 'ejecución' : 'ejecuciones'}`}
      </p>
      {origen === null ? null : <p className="text-xs text-tinta-suave">{origen}</p>}
      {m.resumen_d01 === null ? (
        <p className="text-sm text-oxido">
          La configuración D01 de este método no es válida: no se muestran reglas.
        </p>
      ) : m.clase === 'atributo' ? null : (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-liquen-oscuro">
            Lo que exige D01 (solo lectura)
          </summary>
          <dl className="grid gap-x-4 gap-y-1 pb-2 sm:grid-cols-[12rem_1fr]">
            {m.resumen_d01.map((r, i) => (
              <div key={`${r.clave}-${String(i)}`} className="contents">
                <dt className="font-semibold text-tinta-suave">{r.etiqueta}</dt>
                <dd>
                  {r.valor === '' ? '—' : r.valor}
                  {r.tipo_control === null ? null : (
                    <span className="text-tinta-suave">
                      {' '}
                      ({ETIQUETAS_TIPO_CONTROL[r.tipo_control]})
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <Acciones m={m} puedeDecidir={puedeDecidir} alDecidir={alDecidir} />
    </li>
  );
};

/** Contenido del panel; se usa en Estaciones (debajo de la tabla) y en el cronograma (diálogo). */
export const MetodosEstacion = ({
  estacionId,
  soloPendientesInicial = false,
}: {
  estacionId: string;
  /** Abre filtrado en los CONDICIONAL que esperan confirmación (P-01). */
  soloPendientesInicial?: boolean;
}) => {
  const q = useQuery({
    queryKey: ['metodos-estacion', estacionId],
    queryFn: () => api.get<MetodosDeEstacion>(`/estaciones/${estacionId}/metodos`),
  });
  const [soloPendientes, setSoloPendientes] = useState(soloPendientesInicial);
  const [decidiendo, setDecidiendo] = useState<{ m: MetodoDeEstacion; d: Decision } | null>(null);

  if (q.isPending) return <Cargando que="los métodos de la estación" />;
  if (q.error !== null) return <AvisoError error={q.error} />;
  const p = q.data;
  const grupos = p.especialidades
    .map((s) => ({
      ...s,
      metodos: soloPendientes
        ? s.metodos.filter((m) => m.estado === 'condicion_pendiente')
        : s.metodos,
    }))
    .filter((s) => s.metodos.length > 0);
  const aplicables = p.especialidades
    .flatMap((s) => s.metodos)
    .filter((m) => m.estado === 'aplicable' && m.clase !== 'evento').length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Estación <strong>{p.estacion.codigo}</strong>: región {p.estacion.region ?? 'sin dato'}, UV{' '}
        {p.estacion.uv ?? 'sin dato'}, ZA/EF{' '}
        {p.estacion.za_ef === null || p.estacion.za_ef === '' ? 'no' : p.estacion.za_ef}.{' '}
        {aplicables} {aplicables === 1 ? 'método aplicable' : 'métodos aplicables'}.
      </p>
      {p.pendientes > 0 ? (
        <p role="status" className="rounded-md border border-ocre bg-ocre-claro px-3 py-2 text-sm">
          <span aria-hidden="true">? </span>
          {p.pendientes === 1
            ? '1 método condicional espera confirmación (P-01).'
            : `${String(p.pendientes)} métodos condicionales esperan confirmación (P-01).`}
          {p.puede_decidir
            ? ' Confírmelo o descártelo con un motivo.'
            : ' Los confirma Coordinación o el Jefe de Proyecto.'}
        </p>
      ) : null}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={soloPendientes}
          onChange={(e) => setSoloPendientes(e.target.checked)}
          className="size-5 accent-liquen"
        />
        Mostrar solo los que esperan confirmación
      </label>
      {grupos.length === 0 ? (
        <Vacio
          titulo={soloPendientes ? 'Ningún método espera confirmación' : 'Sin métodos configurados'}
        >
          {soloPendientes ? null : 'Cargue la configuración D01 del proyecto.'}
        </Vacio>
      ) : (
        grupos.map((s) => (
          <section
            key={s.id ?? s.nombre}
            aria-label={s.nombre}
            className="rounded-md border border-linea bg-hoja"
          >
            <h3 className="border-b border-linea px-4 py-2 font-semibold">{s.nombre}</h3>
            <ul>
              {s.metodos.map((m) => (
                <FilaMetodo
                  key={m.metodo_id}
                  m={m}
                  puedeDecidir={p.puede_decidir}
                  alDecidir={(d) => setDecidiendo({ m, d })}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {decidiendo === null ? null : (
        <DialogoDecision
          key={`${decidiendo.m.metodo_id}-${decidiendo.d}`}
          estacionId={estacionId}
          estacionCodigo={p.estacion.codigo}
          metodo={decidiendo.m}
          decision={decidiendo.d}
          alCerrar={() => setDecidiendo(null)}
        />
      )}
    </div>
  );
};

/** El mismo panel en un diálogo (desde el cronograma). */
export const DialogoMetodosEstacion = ({
  estacionId,
  estacionCodigo,
  alCerrar,
}: {
  estacionId: string;
  estacionCodigo: string;
  alCerrar: () => void;
}) => (
  <Dialogo abierto amplio titulo={`Métodos a ejecutar en ${estacionCodigo}`} alCerrar={alCerrar}>
    <MetodosEstacion estacionId={estacionId} />
  </Dialogo>
);
