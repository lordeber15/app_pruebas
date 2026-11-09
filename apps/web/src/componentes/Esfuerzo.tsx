import type { EsfuerzoEjecucion, Interrupcion } from '@campo/core';
import { fechaHora } from './Ui.tsx';

/**
 * Esfuerzo planificado vs. ejecutado (RF-T05, RN-19, D01 T-10). Lo calcula la API con core; aquí
 * solo se presenta. Las interrupciones o fallas no son incumplimientos: se muestran con su motivo.
 */

const num = (n: number): string =>
  new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(n);

const minutos = (n: number | null): string => (n === null ? '—' : `${num(n)} min`);

const unidad = (e: EsfuerzoEjecucion): string =>
  e.planificado.medida === 'minutos' ? 'min' : e.planificado.unidad_texto;

export const textoPlanificado = (e: EsfuerzoEjecucion): string =>
  e.planificado.cantidad === null
    ? e.planificado.origen === 'referencia'
      ? 'lo define el especialista'
      : 'sin objetivo en D01'
    : `${num(e.planificado.cantidad)} ${unidad(e)}`;

/** Una línea por ejecución: ejecutado / planificado, duración efectiva e interrupciones. */
export const LineaEsfuerzo = ({ e }: { e: EsfuerzoEjecucion }) => {
  const registros = e.ejecutado.interrupciones + e.ejecutado.fallas;
  return (
    <span className="cifras">
      {num(e.ejecutado.cantidad)} {unidad(e)} de {textoPlanificado(e)}
      {e.diferencia === null || e.diferencia === 0 ? null : (
        <span className="text-tinta-suave">
          {' '}
          ({e.diferencia > 0 ? '+' : '−'}
          {num(Math.abs(e.diferencia))})
        </span>
      )}
      {e.ejecutado.efectivo_min === null ? (
        <span className="text-tinta-suave"> · en curso</span>
      ) : (
        <span className="text-tinta-suave"> · {minutos(e.ejecutado.efectivo_min)} efectivos</span>
      )}
      {registros === 0 ? null : (
        <span className="text-ocre">
          {' '}
          · <span aria-hidden="true">⚠ </span>
          {e.ejecutado.interrupciones > 0
            ? `${String(e.ejecutado.interrupciones)} interrupción${e.ejecutado.interrupciones === 1 ? '' : 'es'}`
            : ''}
          {e.ejecutado.interrupciones > 0 && e.ejecutado.fallas > 0 ? ', ' : ''}
          {e.ejecutado.fallas > 0
            ? `${String(e.ejecutado.fallas)} falla${e.ejecutado.fallas === 1 ? '' : 's'}`
            : ''}
        </span>
      )}
    </span>
  );
};

const NOMBRE_INTERRUPCION: Readonly<Record<Interrupcion['tipo'], string>> = {
  interrupcion: 'Interrupción',
  falla: 'Falla de equipo o método',
};

/** Sección del detalle de una ejecución. */
export const SeccionEsfuerzo = ({
  esfuerzo,
  interrupciones,
}: {
  esfuerzo: EsfuerzoEjecucion;
  interrupciones: readonly Interrupcion[];
}) => (
  <div className="flex flex-col gap-3">
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt className="text-tinta-suave">Planificado</dt>
        <dd className="cifras">{textoPlanificado(esfuerzo)}</dd>
      </div>
      <div>
        <dt className="text-tinta-suave">Ejecutado</dt>
        <dd className="cifras">
          {num(esfuerzo.ejecutado.cantidad)} {unidad(esfuerzo)}
          {esfuerzo.diferencia === null ? null : (
            <span className="text-tinta-suave">
              {' '}
              (diferencia {esfuerzo.diferencia > 0 ? '+' : esfuerzo.diferencia < 0 ? '−' : ''}
              {num(Math.abs(esfuerzo.diferencia))})
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-tinta-suave">Inicio / fin</dt>
        <dd className="cifras">
          {fechaHora(esfuerzo.ejecutado.inicio)} /{' '}
          {esfuerzo.ejecutado.fin === null ? 'en curso' : fechaHora(esfuerzo.ejecutado.fin)}
        </dd>
      </div>
      <div>
        <dt className="text-tinta-suave">Duración / efectiva</dt>
        <dd className="cifras">
          {minutos(esfuerzo.ejecutado.duracion_min)} / {minutos(esfuerzo.ejecutado.efectivo_min)}
        </dd>
      </div>
    </dl>
    {interrupciones.length === 0 ? (
      <p className="text-sm text-tinta-suave">Sin interrupciones ni fallas registradas.</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {interrupciones.map((i) => (
          <li key={i.id} className="rounded-md border border-linea px-3 py-2">
            <span className="font-semibold">
              <span aria-hidden="true">⚠ </span>
              {NOMBRE_INTERRUPCION[i.tipo]}
            </span>{' '}
            <span className="cifras text-tinta-suave">
              {fechaHora(i.inicio)} – {i.fin === null ? 'sin reanudar' : fechaHora(i.fin)}
            </span>
            <br />
            {i.motivo}
          </li>
        ))}
      </ul>
    )}
  </div>
);
