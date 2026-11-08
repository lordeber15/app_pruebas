import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type BrigadaSeguimiento, type FilaSeguimiento } from '../api.ts';
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

/** Estados de la ejecución en el servidor, en el lenguaje del modelo visible. */
const ESTADO_EJECUCION: Readonly<Record<string, string>> = {
  en_curso: 'en curso',
  evidencia_pendiente: 'evidencia pendiente',
  completa: 'completa',
  parcial: 'parcial',
  validada: 'validada',
  observada: 'observada',
};

const nombreBrigada = (b: { codigo: string | null; nombre: string }): string =>
  b.codigo === null || b.codigo === b.nombre ? b.nombre : `${b.codigo} · ${b.nombre}`;

const porcentaje = (n: number): string =>
  `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(n)} %`;

/**
 * Avance elemental de un método (RN-38). Sin datos: un aviso explícito, nunca 0 % (RN-37). La
 * barra acompaña al número; el color no es el único indicador.
 */
const Avance = ({ f }: { f: FilaSeguimiento }) => {
  if (f.sin_datos || f.avance === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-linea px-2 py-1 text-xs text-tinta-suave">
        <span aria-hidden="true">○</span> Sin datos sincronizados
      </span>
    );
  }
  const { ejecutado, porcentaje: p } = f.avance;
  const unidad = f.objetivo.medida === 'minutos' ? 'min' : f.objetivo.unidad_texto;
  if (p === null) {
    return (
      <span className="text-sm">
        {ejecutado} {unidad} <span className="text-tinta-suave">(sin objetivo numérico)</span>
      </span>
    );
  }
  const completo = p >= 100;
  return (
    <div className="flex min-w-36 flex-col gap-1">
      <span className="text-sm font-semibold">
        {porcentaje(p)} {completo ? <span aria-hidden="true">✓</span> : null}
        <span className="font-normal text-tinta-suave">
          {' '}
          ({ejecutado} de {f.avance.objetivo} {unidad})
        </span>
      </span>
      <span className="h-2 w-full overflow-hidden rounded-full bg-liquen-claro" aria-hidden="true">
        <span
          className={`block h-full ${completo ? 'bg-liquen-oscuro' : 'bg-liquen'}`}
          style={{ width: `${String(Math.min(100, p))}%` }}
        />
      </span>
    </div>
  );
};

const Objetivo = ({ f }: { f: FilaSeguimiento }) => {
  const o = f.objetivo;
  const cantidad =
    o.cantidad === null
      ? o.origen === 'referencia'
        ? 'Lo define el especialista en campo'
        : 'Sin objetivo en D01'
      : `${String(o.cantidad)} ${o.medida === 'minutos' ? 'minutos' : o.unidad_texto}`;
  return (
    <span title={o.texto}>
      {cantidad}
      {o.origen === 'campo' ? <span className="text-tinta-suave"> (valor de campo)</span> : null}
      {o.origen.includes('za_ef') ? <span className="text-tinta-suave"> (ZA/EF)</span> : null}
    </span>
  );
};

const Estados = ({ f }: { f: FilaSeguimiento }) => {
  const partes = Object.entries(f.por_estado);
  if (partes.length === 0) return <span className="text-tinta-suave">—</span>;
  return (
    <span>
      {partes.map(([estado, n]) => `${String(n)} ${ESTADO_EJECUCION[estado] ?? estado}`).join(', ')}
    </span>
  );
};

const TablaBrigada = ({ b }: { b: BrigadaSeguimiento }) => (
  <section className="flex flex-col gap-3" aria-labelledby={`brigada-${b.id}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={`brigada-${b.id}`} className="text-lg font-semibold">
        {nombreBrigada(b)}
      </h2>
      <p className="text-sm" role="status">
        {b.ultima_sincronizacion === null ? (
          <span className="text-ocre">
            <span aria-hidden="true">⚠ </span>Aún no se recibe ninguna sincronización de esta
            brigada.
          </span>
        ) : (
          <>
            Última sincronización:{' '}
            <strong className="cifras">{fechaHora(b.ultima_sincronizacion)}</strong>
            {b.dispositivos.length > 1 ? ` (${String(b.dispositivos.length)} dispositivos)` : ''}
          </>
        )}
      </p>
    </div>
    {b.solo_propias ? (
      <p className="text-sm text-tinta-suave">Se muestra solo el esfuerzo de sus ejecuciones.</p>
    ) : null}
    {b.filas.length === 0 ? (
      <Vacio titulo="Esta brigada no tiene métodos programados ni ejecuciones recibidas" />
    ) : (
      <Tabla titulo={`Avance de ${nombreBrigada(b)}`}>
        <thead>
          <tr>
            <th className={th}>Estación</th>
            <th className={th}>Especialidad y método</th>
            <th className={th}>Programada</th>
            <th className={th}>Objetivo aplicable</th>
            <th className={th}>Avance elemental</th>
            <th className={th}>Ejecuciones</th>
          </tr>
        </thead>
        <tbody>
          {b.filas.map((f) => (
            <tr key={`${f.estacion_id}|${f.metodo_id}`}>
              <td className={`${td} font-semibold`}>
                {f.estacion_codigo}
                {f.za_ef === null || f.za_ef === '' ? null : (
                  <span className="ml-1 rounded bg-ocre-claro px-1 text-xs font-normal text-ocre">
                    ZA/EF
                  </span>
                )}
              </td>
              <td className={td}>
                <span className="text-tinta-suave">{f.especialidad_nombre}</span>
                <br />
                {f.metodo_nombre}
              </td>
              <td className={`${td} cifras whitespace-nowrap`}>{f.fecha_programada ?? '—'}</td>
              <td className={td}>
                <Objetivo f={f} />
              </td>
              <td className={td}>
                <Avance f={f} />
              </td>
              <td className={td}>
                <Estados f={f} />
              </td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    )}
  </section>
);

/** Dashboard de seguimiento (D02 §12, RF-W01, E-09). */
export const Seguimiento = () => {
  const proyectoId = useProyectoId();
  const [brigada, setBrigada] = useState('');
  const todas = useQuery({
    queryKey: ['seguimiento', proyectoId],
    queryFn: () =>
      api.get<{ generado_en: string; brigadas: BrigadaSeguimiento[] }>(
        `/proyectos/${proyectoId}/seguimiento`,
      ),
    refetchInterval: 60_000,
  });
  const lista = todas.data?.brigadas ?? [];
  const visibles = brigada === '' ? lista : lista.filter((b) => b.id === brigada);

  return (
    <>
      <Encabezado titulo="Seguimiento" />
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Avance elemental por método: esfuerzo ejecutado (suma de las ejecuciones de cada
        especialista) frente al objetivo aplicable de D01. La web solo muestra lo recibido por el
        servidor: «sin datos sincronizados» no significa 0 % ni incumplimiento. El avance agregado
        por estación o brigada está pendiente de definir (P-11) y no se calcula.
      </p>
      {todas.isPending ? <Cargando que="el seguimiento" /> : null}
      <AvisoError error={todas.error} />
      {todas.data !== undefined && lista.length === 0 ? (
        <Vacio titulo="No hay brigadas a su alcance en este proyecto">
          Las brigadas llegan con la carga de A01.
        </Vacio>
      ) : null}
      {lista.length > 0 ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full max-w-xs">
              <Campo etiqueta="Brigada">
                {(id) => (
                  <select
                    id={id}
                    value={brigada}
                    onChange={(e) => setBrigada(e.target.value)}
                    className={claseEntrada}
                  >
                    <option value="">Todas las brigadas</option>
                    {lista.map((b) => (
                      <option key={b.id} value={b.id}>
                        {nombreBrigada(b)}
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
            </div>
            <p className="text-xs text-tinta-suave">
              Consultado: {fechaHora(todas.data?.generado_en)}. Se actualiza cada minuto.
            </p>
          </div>
          {visibles.map((b) => (
            <TablaBrigada key={b.id} b={b} />
          ))}
        </div>
      ) : null}
    </>
  );
};
