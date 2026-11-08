import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import {
  api,
  type ConfiguracionD01 as Estado,
  type ImportacionD01,
  type ResultadoAplicacionD01,
} from '../api.ts';
import { AvisoError, Boton, Cargando, claseEntrada, fechaHora, Tabla, td, th } from './Ui.tsx';

/**
 * «Configuración por método (D01)» (RF-W09): descargar la plantilla Excel (vacía o con la versión
 * vigente), subirla, revisar la vista previa (cambios campo a campo y errores por fila y columna)
 * y aplicarla con un motivo, lo que crea una versión nueva. Solo Coordinación y JdP; la API vuelve
 * a autorizar cada paso.
 */
export const ConfiguracionD01 = ({ proyectoId }: { proyectoId: string }) => {
  const qc = useQueryClient();
  const idArchivo = useId();
  const idMotivo = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState('');

  const estado = useQuery({
    queryKey: ['configuracion-d01', proyectoId],
    queryFn: () => api.get<Estado>(`/proyectos/${proyectoId}/configuracion/d01`),
  });
  const descarga = useMutation({
    mutationFn: (conDatos: boolean) =>
      api.descargar(
        `/proyectos/${proyectoId}/configuracion/d01/plantilla?con_datos=${conDatos ? '1' : '0'}`,
        'D01_plantilla.xlsx',
      ),
  });
  const subida = useMutation({
    mutationFn: (f: File) =>
      api.subir<ImportacionD01>(
        `/proyectos/${proyectoId}/configuracion/d01/importar`,
        'archivo',
        f,
      ),
    onSuccess: async () => {
      aplicacion.reset();
      await qc.invalidateQueries({ queryKey: ['configuracion-d01', proyectoId] });
    },
  });
  const vista = subida.data;
  const aplicacion = useMutation({
    mutationFn: (id: string) =>
      api.post<ResultadoAplicacionD01>(`/importaciones-d01/${id}/aplicar`, { motivo }),
    onSuccess: async () => {
      setMotivo('');
      setArchivo(null);
      if (entrada.current !== null) entrada.current.value = '';
      subida.reset();
      // La versión nueva cambia métodos, matriz y reservas de todo el proyecto.
      await qc.invalidateQueries();
    },
  });

  const vigente = estado.data?.vigente ?? null;
  const cambiados = vista?.metodos.filter((m) => m.estado === 'cambiado') ?? [];
  const nuevos = vista?.metodos.filter((m) => m.estado === 'nuevo') ?? [];
  const r = aplicacion.data;

  return (
    <section
      aria-labelledby="titulo-d01"
      className="mb-6 rounded-md border border-linea bg-hoja px-4 py-4"
    >
      <h2 id="titulo-d01" className="text-lg font-semibold">
        Configuración por método (D01)
      </h2>
      {estado.isPending ? <Cargando que="la configuración vigente" /> : null}
      <AvisoError error={estado.error} />
      {estado.data === undefined ? null : (
        <p className="mt-1 text-sm text-tinta-suave">
          {vigente === null
            ? 'El proyecto aún no tiene configuración D01.'
            : `Versión vigente ${String(vigente.numero)}: ${String(vigente.metodos)} métodos, desde el ${fechaHora(vigente.creado_en)}${vigente.creado_por_nombre === null ? '' : ` (${vigente.creado_por_nombre})`}. Origen: ${vigente.origen}.`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Boton
          variante="secundario"
          ocupado={descarga.isPending && descarga.variables}
          disabled={vigente === null}
          onClick={() => descarga.mutate(true)}
        >
          Descargar con la configuración vigente
        </Boton>
        <Boton
          variante="secundario"
          ocupado={descarga.isPending && !descarga.variables}
          onClick={() => descarga.mutate(false)}
        >
          Descargar plantilla vacía
        </Boton>
      </div>
      <AvisoError error={descarga.error} />

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (archivo !== null) subida.mutate(archivo);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={idArchivo} className="text-sm font-semibold">
            Plantilla completada (.xlsx, hasta 5 MB)
          </label>
          <input
            ref={entrada}
            id={idArchivo}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(ev) => setArchivo(ev.target.files?.[0] ?? null)}
            className="min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-linea file:bg-hoja file:px-3"
          />
        </div>
        <Boton type="submit" disabled={archivo === null} ocupado={subida.isPending}>
          Subir y revisar
        </Boton>
      </form>
      <p className="mt-1 text-xs text-tinta-suave">
        Subir no cambia nada: primero verá la vista previa. Aplicarla crea una versión nueva; las
        ejecuciones ya registradas conservan su versión.
      </p>
      <AvisoError error={subida.error} />

      {vista === undefined ? null : (
        <div className="mt-4 flex flex-col gap-4" aria-live="polite">
          <p role="status" className="text-sm">
            <strong className="font-semibold">Vista previa de «{vista.archivo_nombre}»</strong>{' '}
            contra la versión {vista.version_base ?? '—'}: {vista.resumen.nuevos} métodos nuevos,{' '}
            {vista.resumen.cambiados} con cambios, {vista.resumen.sin_cambio} sin cambio
            {vista.resumen.no_incluidos > 0
              ? `, ${String(vista.resumen.no_incluidos)} no incluidos en el archivo (se conservan sin cambios)`
              : ''}{' '}
            y {vista.resumen.errores} errores.
          </p>

          {vista.errores.length > 0 ? (
            <div>
              <h3 className="mb-2 font-semibold text-oxido">
                <span aria-hidden="true">✕ </span>Errores: corrija el archivo y vuelva a subirlo
              </h3>
              <Tabla titulo="Errores de la plantilla por fila y columna">
                <thead>
                  <tr>
                    <th className={th}>Hoja</th>
                    <th className={th}>Fila</th>
                    <th className={th}>Columna</th>
                    <th className={th}>Problema</th>
                  </tr>
                </thead>
                <tbody>
                  {vista.errores.slice(0, 200).map((e, i) => (
                    <tr key={`${e.hoja}-${String(e.fila)}-${e.columna ?? ''}-${String(i)}`}>
                      <td className={td}>{e.hoja}</td>
                      <td className={td}>{e.fila ?? '—'}</td>
                      <td className={td}>{e.columna ?? '—'}</td>
                      <td className={td}>{e.mensaje}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
              {vista.errores.length > 200 ? (
                <p className="mt-1 text-sm text-tinta-suave">
                  Se muestran los primeros 200 de {vista.errores.length} errores.
                </p>
              ) : null}
            </div>
          ) : null}

          {nuevos.length > 0 ? (
            <div>
              <h3 className="mb-1 font-semibold">Métodos nuevos</h3>
              <ul className="list-disc pl-5 text-sm">
                {nuevos.map((m) => (
                  <li key={m.codigo}>
                    {m.nombre}{' '}
                    <span className="text-tinta-suave">
                      ({m.codigo}, fila {m.fila})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {cambiados.map((m) => (
            <div key={m.codigo}>
              <h3 className="mb-2 font-semibold">
                {m.nombre} <span className="font-normal text-tinta-suave">({m.codigo})</span>
              </h3>
              <Tabla titulo={`Cambios en ${m.nombre}`}>
                <thead>
                  <tr>
                    <th className={th}>Campo</th>
                    <th className={th}>Antes</th>
                    <th className={th}>Después</th>
                  </tr>
                </thead>
                <tbody>
                  {m.cambios.map((c) => (
                    <tr key={c.campo}>
                      <td className={td}>{c.campo}</td>
                      <td className={`${td} whitespace-pre-wrap break-words`}>{c.antes}</td>
                      <td className={`${td} whitespace-pre-wrap break-words font-semibold`}>
                        {c.despues}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>
          ))}

          {vista.aplicable ? (
            <form
              className="flex flex-col gap-2 border-t border-linea pt-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                aplicacion.mutate(vista.id);
              }}
            >
              <label htmlFor={idMotivo} className="text-sm font-semibold">
                Motivo del cambio
              </label>
              <textarea
                id={idMotivo}
                required
                minLength={3}
                maxLength={500}
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                className={`${claseEntrada} min-h-20 py-2`}
                placeholder="Por ejemplo: el cliente corrigió la separación mínima de los transectos."
              />
              <div>
                <Boton
                  type="submit"
                  ocupado={aplicacion.isPending}
                  disabled={motivo.trim().length < 3}
                >
                  Aplicar como versión {(vista.version_base ?? 0) + 1}
                </Boton>
              </div>
            </form>
          ) : vista.errores.length === 0 ? (
            <p className="text-sm text-tinta-suave">
              El archivo no cambia la configuración vigente: no hay nada que aplicar.
            </p>
          ) : null}
          <AvisoError error={aplicacion.error} />
        </div>
      )}

      {r === undefined ? null : (
        <p role="status" className="mt-4 text-sm text-liquen-oscuro">
          <span aria-hidden="true">✓ </span>
          Versión {r.configuracion_numero} aplicada con {r.metodos} métodos.{' '}
          {r.reservas_trasladadas} reservas pasan a la versión nueva y se crearon{' '}
          {r.reservas_creadas} reservas; se conservaron {r.nominales_trasladadas} decisiones
          nominales.
          {r.estacion_metodo_pendientes > 0
            ? ` ${String(r.estacion_metodo_pendientes)} combinaciones estación–método esperan confirmación (P-01).`
            : ''}
        </p>
      )}

      {(estado.data?.importaciones.length ?? 0) > 0 ? (
        <details className="mt-4 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">
            Últimas cargas de la plantilla
          </summary>
          <ul className="flex flex-col gap-1">
            {estado.data?.importaciones.map((i) => (
              <li key={i.id}>
                {fechaHora(i.creado_en)} · {i.archivo_nombre} · {i.creado_por_nombre} ·{' '}
                {i.estado === 'aplicada'
                  ? `aplicada como versión ${String(i.version_numero ?? '—')} por ${i.aplicado_por_nombre ?? '—'}: «${i.motivo ?? ''}»`
                  : i.con_errores
                    ? 'con errores, sin aplicar'
                    : 'vista previa sin aplicar'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
};
